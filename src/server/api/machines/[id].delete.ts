import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No machine id provided' });
	const { machine } = await requireMachineAccess(event, id, 'manage');
	// jobs keep their history; the FK is set null on delete
	await db.delete(machines).where(eq(machines.id, machine.id));
	return { ok: true };
});
