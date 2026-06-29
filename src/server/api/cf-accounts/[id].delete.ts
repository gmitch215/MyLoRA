import { eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, cloudflareAccounts } from '~/server/db/schema';
import { requireCapability } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canManageAccounts');
	await ensureDatabase();

	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No account id provided' });

	const existing = (
		await db
			.select({ id: cloudflareAccounts.id })
			.from(cloudflareAccounts)
			.where(eq(cloudflareAccounts.id, id))
			.limit(1)
	)[0];
	if (!existing) throw createError({ statusCode: 404, statusMessage: 'Account not found' });

	// block deletion while any adapter still references this account
	const refs = await db
		.select({ count: sql<number>`count(*)` })
		.from(adapters)
		.where(eq(adapters.accountId, id));
	const count = Number(refs[0]?.count ?? 0);
	if (count > 0) {
		throw createError({
			statusCode: 409,
			statusMessage: `Account is referenced by ${count} adapter(s); reassign or remove them first`
		});
	}

	await db.delete(cloudflareAccounts).where(eq(cloudflareAccounts.id, id));
	return { ok: true };
});
