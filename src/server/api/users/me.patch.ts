import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { users } from 'hub:db:schema';
import { sendEmailConfirmation } from '~/server/utils/email-confirm';
import { cloudflareEnv } from '~/server/utils/mail';

export default defineEventHandler(async (event) => {
	const me = await requireAuthed(event);
	await ensureDatabase();

	const body = await readBody(event);
	const parsed = profileUpdateSchema.safeParse(body);
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid profile data'),
			data: { issues: parsed.error.issues }
		});
	}

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName;
	if (parsed.data.bio !== undefined) updates.bio = parsed.data.bio || null;
	let emailChanged = false;
	if (parsed.data.email !== undefined) {
		const next = parsed.data.email.toLowerCase() || null;
		const current = (
			await db.select({ email: users.email }).from(users).where(eq(users.id, me.id)).limit(1)
		)[0];
		if ((current?.email ?? null) !== next) {
			updates.email = next;
			// a new address starts unconfirmed; the old confirmation says nothing about it
			updates.emailConfirmedAt = null;
			emailChanged = !!next;
		}
	}
	if (parsed.data.notifyJobs !== undefined) updates.notifyJobs = parsed.data.notifyJobs;

	// job emails need somewhere to go: check the address the row will hold after this update
	const wantsEmails = parsed.data.notifyJobs ?? parsed.data.email !== undefined;
	if (wantsEmails) {
		const row = (
			await db
				.select({ email: users.email, notifyJobs: users.notifyJobs })
				.from(users)
				.where(eq(users.id, me.id))
				.limit(1)
		)[0];
		const email = 'email' in updates ? updates.email : row?.email;
		const notify = 'notifyJobs' in updates ? updates.notifyJobs : row?.notifyJobs;
		if (notify && !email) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Add an email address to get job emails'
			});
		}
	}

	if (parsed.data.newPassword) {
		if (!parsed.data.currentPassword) {
			throw createError({ statusCode: 400, statusMessage: 'Current password is required' });
		}
		const rows = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
		const current = rows[0];
		if (!current) throw createError({ statusCode: 404, statusMessage: 'User not found' });
		const ok = await verifyPassword(current.passwordHash, parsed.data.currentPassword);
		if (!ok) {
			throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect' });
		}
		updates.passwordHash = await hashPassword(parsed.data.newPassword);
	}

	await db.update(users).set(updates).where(eq(users.id, me.id));
	await invalidateUser(me.id);
	if (emailChanged) await sendEmailConfirmation(cloudflareEnv(event), me.id, { force: true });
	return { ok: true };
});
