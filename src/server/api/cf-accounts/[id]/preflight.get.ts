import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { cloudflareAccounts } from 'hub:db:schema';

// preflight a registered account's token: can it CREATE finetunes (Workers AI: Edit)? surfaced in the
// account menu so a read-only / under-scoped token is caught before a publish ever fails
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canManageAccounts');
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No account id provided' });

	const account = (
		await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).limit(1)
	)[0];
	if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' });

	await assertEncryptionKey();
	const token = await decryptToken(account);
	const perm = await checkFinetuneWritePermission(account.accountId, token);
	return { canPublish: perm.canPublish, detail: perm.detail, tokenScope: account.tokenScope };
});
