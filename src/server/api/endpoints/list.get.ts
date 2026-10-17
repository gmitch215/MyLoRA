import { desc, eq, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { inferenceEndpoints } from 'hub:db:schema';
import { adapterCounts, redactEndpoint } from '~/server/utils/endpoints';
import type { PublicEndpoint } from '~/shared/types';

// shared endpoints plus the caller's own; an administrator sees every endpoint
export default defineEventHandler(async (event): Promise<PublicEndpoint[]> => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const rows =
		user.role === 'administrator'
			? await db.select().from(inferenceEndpoints).orderBy(desc(inferenceEndpoints.createdAt))
			: await db
					.select()
					.from(inferenceEndpoints)
					.where(or(eq(inferenceEndpoints.shared, true), eq(inferenceEndpoints.ownerId, user.id)))
					.orderBy(desc(inferenceEndpoints.createdAt));
	const counts = await adapterCounts();
	return rows.map((r) => redactEndpoint(r, counts.get(r.id) ?? 0));
});
