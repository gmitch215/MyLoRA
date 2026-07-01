// advance a job by one step on demand; the guaranteed driver under nuxi dev + the e2e suite, where
// the cron trigger and durable-object alarm do not run
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No job id provided' });
	await requireJobAccess(event, id);
	await advanceJob(id);
	const job = await jobView(id);
	if (!job) throw createError({ statusCode: 404, statusMessage: 'Job not found' });
	return { job };
});
