import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

// kick off a background machine-prepare: builds a persistent ~/.mylora venv that warms uv's wheel
// cache (so training-job venvs install instantly) + writes a prepared.json marker. returns at once;
// the real prepared state lands on the next Test Connection (preflight reads prepared.json).
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No machine id provided' });
	const { machine } = await requireMachineAccess(event, id, 'manage');

	const body = (await readBody(event).catch(() => ({}))) as {
		doc2loraExtras?: 'core' | 'docs' | 'all';
		load4bit?: boolean;
		pythonVersion?: string;
	};
	const doc2loraExtras =
		body.doc2loraExtras === 'core' || body.doc2loraExtras === 'all' ? body.doc2loraExtras : 'docs';
	const load4bit = body.load4bit === true;
	const pythonVersion = /^\d+(\.\d+){0,2}$/.test(body.pythonVersion ?? '')
		? body.pythonVersion!
		: '3.11';

	const creds = await resolveMachineCreds(machine);
	await prepareMachine(creds, { doc2loraExtras, load4bit, pythonVersion });

	// mark it preparing immediately for instant UI feedback (merged into the stored systemInfo);
	// the box also writes prepared.json which a later Test Connection reads back as ready
	const sys = (machine.systemInfo ? safeJsonParse(machine.systemInfo) : {}) ?? {};
	sys.prepared = { status: 'preparing', at: new Date().toISOString(), doc2loraExtras, load4bit };
	await db
		.update(machines)
		.set({ systemInfo: JSON.stringify(sys), updatedAt: new Date() })
		.where(eq(machines.id, id));

	const row = (await db.select().from(machines).where(eq(machines.id, id)).limit(1))[0]!;
	return {
		machine: redactMachine(row),
		message: 'Preparing dependencies in the background. Re-test the connection in a few minutes.'
	};
});

function safeJsonParse(raw: string): Record<string, unknown> | null {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
