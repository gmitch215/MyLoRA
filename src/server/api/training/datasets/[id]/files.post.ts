import { blob } from 'hub:blob';
import { datasetSummary, uniqueDatasetName } from '~/server/utils/datasets';

// append one or more files to an existing dataset (multi-file picker, additive across clicks)
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No dataset id provided' });
	const limits = await getLimits();

	const form = await readFormData(event);
	const files = form.getAll('file').filter((f): f is File => f instanceof File);
	if (!files.length) throw createError({ statusCode: 400, statusMessage: 'No file provided' });

	const existing = (await datasetSummary(id)).size;
	const incoming = files.reduce((a, f) => a + f.size, 0);
	if (existing + incoming > limits.maxWeightsBytes) {
		throw createError({ statusCode: 413, statusMessage: 'Dataset exceeds the worker size limit' });
	}

	for (const file of files) {
		const name = await uniqueDatasetName(id, file.name);
		await blob.put(`datasets/${id}/${name}`, file, {
			contentType: file.type || 'application/octet-stream'
		});
	}
	return { datasetId: id, ...(await datasetSummary(id)) };
});
