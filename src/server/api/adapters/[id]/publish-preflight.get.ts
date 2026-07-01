import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters } from 'hub:db:schema';

// proactive preflight for the publish modals: resolve the account that WOULD host this adapter (same
// logic as publish.post.ts, honoring an optional ?accountId choice) and report whether its token can
// create finetunes, so the modal can warn + show exactly which account is used before publishing
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	const { user } = await requireAdapterAccess(event, id, 'edit');
	if (!(await hasCapability(user, 'canPublish'))) {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	const adapter = (await db.select().from(adapters).where(eq(adapters.id, id)).limit(1))[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const requestedAccountId = String(getQuery(event).accountId || '').trim();
	const resolved = await resolveHostingAccount({
		userId: user.id,
		adapterAccountId: adapter.accountId,
		requestedAccountId: requestedAccountId || null
	});
	if (!resolved.account) {
		return {
			canPublish: false,
			detail: resolved.error ?? 'No account available.',
			accountLabel: null,
			accountId: null
		};
	}

	await assertEncryptionKey();
	const token = await decryptToken(resolved.account);
	const perm = await checkFinetuneWritePermission(resolved.account.accountId, token);
	return {
		canPublish: perm.canPublish,
		detail: perm.detail,
		accountLabel: resolved.account.label,
		accountId: resolved.account.id
	};
});
