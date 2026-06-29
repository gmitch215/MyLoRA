import { eq } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { adapters } from 'hub:db:schema';
import { requireAdapterAccess } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';

function parseShots(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? (v as string[]) : [];
	} catch {
		return [];
	}
}

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	const idxParam = getRouterParam(event, 'idx');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	const idx = Number(idxParam);
	if (!Number.isInteger(idx) || idx < 0) {
		throw createError({ statusCode: 400, statusMessage: 'Invalid screenshot index' });
	}
	await requireAdapterAccess(event, id, 'edit');

	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const shots = parseShots(adapter.screenshots);
	if (idx >= shots.length) {
		throw createError({ statusCode: 404, statusMessage: 'Screenshot not found' });
	}
	const [removed] = shots.splice(idx, 1);

	try {
		if (removed) await blob.del(removed);
	} catch (e) {
		console.warn('screenshot blob delete failed', e);
	}

	await db
		.update(adapters)
		.set({ screenshots: JSON.stringify(shots), updatedAt: new Date() })
		.where(eq(adapters.id, id));

	return { ok: true, screenshots: shots };
});
