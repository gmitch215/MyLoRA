import { blob } from 'hub:blob';
import { datasetSummary, sanitizeDatasetName } from '~/server/utils/datasets';

// remove a single file from a dataset (the picker's per-item delete)
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No dataset id provided' });
	const name = String(getQuery(event).name || '').trim();
	if (!name) throw createError({ statusCode: 400, statusMessage: 'No file name provided' });

	await blob.del(`datasets/${id}/${sanitizeDatasetName(name)}`).catch(() => {});
	return { datasetId: id, ...(await datasetSummary(id)) };
});
