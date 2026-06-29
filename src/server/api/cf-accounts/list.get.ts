import { desc } from 'drizzle-orm';
import { db } from 'hub:db';
import { cloudflareAccounts } from '~/server/db/schema';
import { requireCapability } from '~/server/utils/auth';
import { redactAccount } from '~/server/utils/crypto';
import { ensureDatabase } from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canManageAccounts');
	await ensureDatabase();

	const rows = await db
		.select()
		.from(cloudflareAccounts)
		.orderBy(desc(cloudflareAccounts.createdAt));
	// redactAccount strips every secret field; only last4 ever leaves the server
	return rows.map(redactAccount);
});
