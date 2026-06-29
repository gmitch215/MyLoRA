import { eq } from 'drizzle-orm';
import { adapters } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	await requireAdapterAccess(event, id, 'edit');

	const rows = await db
		.select({ status: adapters.status, statusMessage: adapters.statusMessage })
		.from(adapters)
		.where(eq(adapters.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	let job: PushJob | null = null;
	try {
		job = (await kv.get<PushJob>(`mylora:push:${id}`)) ?? null;
	} catch {
		job = null;
	}

	return { status: row.status, statusMessage: row.statusMessage, job };
});
