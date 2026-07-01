import { and, eq, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { cloudflareAccounts } from 'hub:db:schema';

// accounts the current user can publish TO (active + owned-or-shared), redacted. distinct from
// /list (which needs canManageAccounts): a publisher may not manage accounts but still must pick one
export default defineEventHandler(async (event) => {
	const user = await requireAuthed(event);
	await ensureDatabase();
	if (!(await hasCapability(user, 'canPublish')))
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });

	const rows = await db
		.select()
		.from(cloudflareAccounts)
		.where(
			and(
				eq(cloudflareAccounts.isActive, true),
				or(eq(cloudflareAccounts.ownerId, user.id), eq(cloudflareAccounts.shared, true))
			)
		);
	return { accounts: rows.map(redactAccount) };
});
