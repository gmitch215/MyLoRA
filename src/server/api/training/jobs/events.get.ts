import { and, desc, eq, gt } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines, trainingJobs } from 'hub:db:schema';

// drives the notification chips: jobs (for this user, or all for managers) updated since a cursor
export default defineEventHandler(async (event) => {
	const user = await requireAuthed(event);
	await ensureDatabase();
	const caps = await capabilitiesFor(user.role);

	const sinceRaw = getQuery(event).since;
	const since =
		typeof sinceRaw === 'string' ? new Date(sinceRaw) : new Date(Date.now() - 86_400_000);
	const sinceMs = isNaN(since.getTime()) ? new Date(Date.now() - 86_400_000) : since;

	const ownerFilter = caps.canManageMachines ? undefined : eq(trainingJobs.authorId, user.id);
	const rows = await db
		.select()
		.from(trainingJobs)
		.where(
			ownerFilter
				? and(gt(trainingJobs.updatedAt, sinceMs), ownerFilter)
				: gt(trainingJobs.updatedAt, sinceMs)
		)
		.orderBy(desc(trainingJobs.updatedAt))
		.limit(50);

	const labels = new Map<string, string>();
	for (const mid of [...new Set(rows.map((r) => r.machineId).filter(Boolean) as string[])]) {
		const m = (
			await db.select({ label: machines.label }).from(machines).where(eq(machines.id, mid)).limit(1)
		)[0];
		if (m) labels.set(mid, m.label);
	}

	const events = rows.map((r) => ({
		id: r.id,
		status: r.status,
		failureClass: r.failureClass,
		statusMessage: r.statusMessage,
		machineLabel: r.machineId ? (labels.get(r.machineId) ?? null) : null,
		finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
		updatedAt: new Date(r.updatedAt).toISOString()
	}));
	return { events };
});
