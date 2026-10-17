import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, inferenceEndpoints } from 'hub:db:schema';
import { invalidateAdapterLists } from '~/server/utils/cache';
import { loadEndpoint } from '~/server/utils/endpoints';
import { stopServe } from '~/server/utils/serve';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id') ?? '';
	const row = await loadEndpoint(id);
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Endpoint not found' });
	if (row.ownerId !== user.id && user.role !== 'administrator') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	// a running vllm server is stopped first so it does not outlive its record
	if (row.source === 'vllm') await stopServe(id).catch(() => {});

	// adapters fall back to Workers AI instead of pointing at a record that is gone
	await db
		.update(adapters)
		.set({ endpointId: null, endpointModel: null, updatedAt: new Date() })
		.where(eq(adapters.endpointId, id));
	await db.delete(inferenceEndpoints).where(eq(inferenceEndpoints.id, id));
	await invalidateAdapterLists();
	return { ok: true };
});
