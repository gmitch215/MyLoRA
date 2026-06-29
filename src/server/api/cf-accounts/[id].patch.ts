import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { cloudflareAccounts } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canManageAccounts');
	await ensureDatabase();

	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No account id provided' });

	const body = await readBody(event);
	const parsed = cloudflareAccountUpdateSchema.safeParse(body);
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid account data')
		});
	}
	const data = parsed.data;

	const existing = (
		await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).limit(1)
	)[0];
	if (!existing) throw createError({ statusCode: 404, statusMessage: 'Account not found' });

	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (data.label !== undefined) patch.label = data.label;
	if (data.tokenScope !== undefined) patch.tokenScope = data.tokenScope;
	if (data.shared !== undefined) patch.shared = data.shared;
	if (data.isActive !== undefined) patch.isActive = data.isActive;

	// rotating the token: re-verify against cloudflare then re-encrypt
	if (data.apiToken !== undefined) {
		await assertEncryptionKey();
		try {
			await verifyToken(existing.accountId, data.apiToken);
		} catch (e) {
			throw createError({
				statusCode: 400,
				statusMessage: `Token verification failed: ${describeCfError(e)}`
			});
		}
		const enc = await encryptToken(data.apiToken);
		patch.tokenCipher = enc.tokenCipher;
		patch.tokenIv = enc.tokenIv;
		patch.dekCipher = enc.dekCipher;
		patch.dekIv = enc.dekIv;
		patch.tokenLast4 = enc.tokenLast4;
	}

	// only one default account
	if (data.isDefault === true) {
		await db
			.update(cloudflareAccounts)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(and(eq(cloudflareAccounts.isDefault, true), ne(cloudflareAccounts.id, id)));
		patch.isDefault = true;
	} else if (data.isDefault === false) {
		patch.isDefault = false;
	}

	await db.update(cloudflareAccounts).set(patch).where(eq(cloudflareAccounts.id, id));

	const row = (
		await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).limit(1)
	)[0];
	return redactAccount(row!);
});
