import { eq } from 'drizzle-orm';
import { blob, ensureBlob } from 'hub:blob';
import { db } from 'hub:db';
import { adapters } from 'hub:db:schema';
import { requireAdapterAccess } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';
import { getLimits } from '~/server/utils/settings';

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
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	await requireAdapterAccess(event, id, 'edit');

	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const shots = parseShots(adapter.screenshots);
	const limits = await getLimits();
	if (shots.length >= limits.maxScreenshots) {
		throw createError({
			statusCode: 400,
			statusMessage: `At most ${limits.maxScreenshots} screenshots are allowed`
		});
	}

	const form = await readFormData(event);
	const file = form.get('file');
	if (!(file instanceof Blob)) {
		throw createError({ statusCode: 400, statusMessage: 'No file provided' });
	}
	ensureBlob(file, {
		maxSize: '4MB',
		types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
	});

	const uploaded = await blob.put((file as any).name ?? 'screenshot', file, {
		prefix: `adapters/${id}/screenshots`,
		addRandomSuffix: true
	});

	const next = [...shots, uploaded.pathname];
	await db
		.update(adapters)
		.set({ screenshots: JSON.stringify(next), updatedAt: new Date() })
		.where(eq(adapters.id, id));

	return { pathname: uploaded.pathname, screenshots: next };
});
