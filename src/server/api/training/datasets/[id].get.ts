import { datasetSummary } from '~/server/utils/datasets';

// list the files in a doc2lora dataset (drives the picker's viewing list)
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No dataset id provided' });
	return { datasetId: id, ...(await datasetSummary(id)) };
});
