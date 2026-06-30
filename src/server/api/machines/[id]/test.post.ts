import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

// connect, authenticate, run a trivial command, run preflight, and report a specific diagnosis
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No machine id provided' });
	const { machine } = await requireMachineAccess(event, id, 'use');

	await assertEncryptionKey();
	const diag = await testConnection(await resolveMachineCreds(machine));
	await db.update(machines).set(diagnosisToMachineUpdate(diag)).where(eq(machines.id, machine.id));
	const row = (await db.select().from(machines).where(eq(machines.id, machine.id)).limit(1))[0]!;
	return { machine: redactMachine(row), diagnosis: diag };
});
