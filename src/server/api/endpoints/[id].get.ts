import { adapterCounts, loadEndpoint, redactEndpoint } from '~/server/utils/endpoints';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id') ?? '';
	const row = await loadEndpoint(id);
	if (!row || (!row.shared && row.ownerId !== user.id && user.role !== 'administrator')) {
		throw createError({ statusCode: 404, statusMessage: 'Endpoint not found' });
	}
	return redactEndpoint(row, (await adapterCounts()).get(id) ?? 0, { withLog: true });
});
