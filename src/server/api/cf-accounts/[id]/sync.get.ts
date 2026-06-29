import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, cloudflareAccounts } from 'hub:db:schema';
import { requireCapability } from '~/server/utils/auth';
import { importFinetunes, validateAccount } from '~/server/utils/cfimport';
import { assertEncryptionKey, decryptToken } from '~/server/utils/crypto';
import { ensureDatabase } from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageAccounts');
	await ensureDatabase();

	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No account id provided' });

	const account = (
		await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).limit(1)
	)[0];
	if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' });

	await assertEncryptionKey();
	const token = await decryptToken(account);

	const validation = await validateAccount(account.accountId, token);
	if (!validation.ok) {
		throw createError({
			statusCode: 502,
			statusMessage: `Cloudflare sync failed: ${validation.error}`
		});
	}
	const finetunes = validation.finetunes.length;

	// import any finetunes not yet tracked here as 'migrated' adapters
	const imported = await importFinetunes({
		accountRowId: id,
		finetunes: validation.finetunes,
		ownerId: account.ownerId ?? user.id
	});

	// recompute our cached count: any adapter that consumed a cloudflare slot (has a finetune id),
	// including archived ones, since cf slots are not reclaimable until the delete endpoint ships
	const counted = await db
		.select({ count: sql<number>`count(*)` })
		.from(adapters)
		.where(and(eq(adapters.accountId, id), isNotNull(adapters.finetuneId)));
	const adapterCount = Number(counted[0]?.count ?? 0);

	const mismatch = adapterCount !== account.adapterCount;
	if (mismatch) {
		await db
			.update(cloudflareAccounts)
			.set({ adapterCount, updatedAt: new Date() })
			.where(eq(cloudflareAccounts.id, id));
	}

	return { finetunes, adapterCount, mismatch, imported };
});
