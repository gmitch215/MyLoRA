import { eq, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

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
	return { machines: rows.map(redactMachine) };
});
