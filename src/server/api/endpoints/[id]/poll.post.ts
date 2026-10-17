import { adapterCounts, loadEndpoint, redactEndpoint } from '~/server/utils/endpoints';
import { advanceServe } from '~/server/utils/serve';

// advances a serve by one step (the cron does the same); the page calls it while a server starts
export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id') ?? '';
	const row = await loadEndpoint(id);
	if (!row || (!row.shared && row.ownerId !== user.id && user.role !== 'administrator')) {
		throw createError({ statusCode: 404, statusMessage: 'Endpoint not found' });
	}
	if (row.source !== 'vllm') {
		throw createError({ statusCode: 409, statusMessage: 'Only a vLLM server can be polled' });
	}

	await advanceServe(id);
	const next = (await loadEndpoint(id))!;
	return redactEndpoint(next, (await adapterCounts()).get(id) ?? 0, { withLog: true });
});
