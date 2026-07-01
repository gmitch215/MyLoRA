import { desc, eq, inArray } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines, trainingJobs } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireAuthed(event);
	await ensureDatabase();
	const caps = await capabilitiesFor(user.role);

	const rows = caps.canManageMachines
		? await db.select().from(trainingJobs).orderBy(desc(trainingJobs.createdAt))
		: await db
				.select()
				.from(trainingJobs)
				.where(eq(trainingJobs.authorId, user.id))
				.orderBy(desc(trainingJobs.createdAt));

	// resolve every machine label in ONE query (avoids an N+1 across the job list)
	const labels = new Map<string, string>();
	const machineIds = [...new Set(rows.map((r) => r.machineId).filter(Boolean) as string[])];
	if (machineIds.length) {
		const ms = await db
			.select({ id: machines.id, label: machines.label })
			.from(machines)
			.where(inArray(machines.id, machineIds));
		for (const m of ms) labels.set(m.id, m.label);
	}

	return { jobs: rows.map((r) => serializeJob(r, r.machineId ? labels.get(r.machineId) : null)) };
});
