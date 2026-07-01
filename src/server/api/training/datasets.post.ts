import { blob } from 'hub:blob';
import { datasetSummary, uniqueDatasetName } from '~/server/utils/datasets';

// create a doc2lora dataset. accepts an empty create (the picker then adds files/urls incrementally),
// an initial multipart batch of files, or a pasted text body. returns the dataset summary.
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	await ensureDatabase();
	const limits = await getLimits();
	const id = crypto.randomUUID().replace(/-/g, '');

	const ct = getHeader(event, 'content-type') || '';

	if (ct.includes('multipart/form-data')) {
		const form = await readFormData(event);
		const files = form.getAll('file').filter((f): f is File => f instanceof File);
		const total = files.reduce((a, f) => a + f.size, 0);
		if (total > limits.maxWeightsBytes) {
			throw createError({ statusCode: 413, statusMessage: 'Upload exceeds the worker size limit' });
		}
		for (const file of files) {
			const name = await uniqueDatasetName(id, file.name);
			await blob.put(`datasets/${id}/${name}`, file, {
				contentType: file.type || 'application/octet-stream'
			});
		}
	} else if (ct.includes('application/json')) {
		const body = await readBody<{ text?: string }>(event).catch(() => ({}) as { text?: string });
		const text = (body?.text ?? '').toString();
		if (text.trim()) {
			const bytes = new TextEncoder().encode(text);
			if (bytes.length > limits.maxWeightsBytes) {
				throw createError({ statusCode: 413, statusMessage: 'Content exceeds the size limit' });
			}
			await blob.put(`datasets/${id}/dataset.txt`, bytes, { contentType: 'text/plain' });
		}
	}
	// otherwise an empty create: the picker adds files/urls next

	return { datasetId: id, ...(await datasetSummary(id)) };
});
