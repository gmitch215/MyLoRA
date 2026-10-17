import { adapterCounts, loadEndpoint, redactEndpoint } from '~/server/utils/endpoints';
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
	if (row.source !== 'vllm') {
		throw createError({ statusCode: 409, statusMessage: 'Only a vLLM server can be stopped' });
	}

	await stopServe(id);
	const next = (await loadEndpoint(id))!;
	return redactEndpoint(next, (await adapterCounts()).get(id) ?? 0, { withLog: true });
});
