export default defineEventHandler(async (event) => {
	const durable = (event.context as { cloudflare?: { durable?: unknown } }).cloudflare?.durable as
		| {
				ctx: {
					storage: {
						put(k: string, v: unknown): Promise<void>;
						setAlarm(t: number): Promise<void>;
					};
				};
		  }
		| undefined;
	if (!durable)
		throw createError({ statusCode: 400, statusMessage: 'Not a durable-object request' });

	const jobId = getQuery(event).jobId;
	if (typeof jobId !== 'string' || !jobId)
		throw createError({ statusCode: 400, statusMessage: 'Missing jobId' });

	await durable.ctx.storage.put('jobId', jobId);
	await durable.ctx.storage.setAlarm(Date.now() + 5_000);
	return { ok: true };
});
