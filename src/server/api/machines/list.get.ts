import { eq, notInArray, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines, trainingJobs } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireAuthed(event);
	await ensureDatabase();
	const caps = await capabilitiesFor(user.role);
	// managers/admins see every machine; developers see shared + their own
	const rows = caps.canManageMachines
		? await db.select().from(machines)
		: await db
				.select()
				.from(machines)
				.where(or(eq(machines.shared, true), eq(machines.ownerId, user.id)));

	// machines currently running a (non-terminal) job -> display 'running'
	const active = await db
		.select({ machineId: trainingJobs.machineId })
		.from(trainingJobs)
		.where(notInArray(trainingJobs.status, ['completed', 'failed', 'abnormal', 'aborted']));
	const busy = new Set(active.map((a) => a.machineId).filter(Boolean) as string[]);

	const list = rows.map((row) => {
		const m = redactMachine(row);
		// derived display health (not stored): an active job -> running; else a near-full GPU ->
		// at_capacity; otherwise the stored health from the last check
		if (busy.has(m.id)) {
			m.healthStatus = 'running';
		} else if (
			m.gpuInfo?.vramUsedMb != null &&
			m.gpuInfo.vramMb > 0 &&
			(m.gpuInfo.vramUsedMb / m.gpuInfo.vramMb) * 100 >= AT_CAPACITY_VRAM_PCT
		) {
			m.healthStatus = 'at_capacity';
		}
		return m;
	});
	return { machines: list };
});
