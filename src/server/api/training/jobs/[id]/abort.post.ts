export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No job id provided' });
	await requireJobAccess(event, id);
	await abortJob(id);
	const job = await jobView(id);
	if (!job) throw createError({ statusCode: 404, statusMessage: 'Job not found' });
	return { job };
});
