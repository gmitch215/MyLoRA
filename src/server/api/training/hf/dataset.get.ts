// validate a huggingface dataset id via the public keyless API: 200 = public/ok, 401 = exists but
// gated (needs a token), 404 = missing. mocked in the test env.
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	const id = String(getQuery(event).id || '').trim();
	if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing dataset id' });

	if (isMockSsh()) {
		const valid = !id.includes('missing');
		const gated = id.includes('gated');
		return { id, valid, gated, status: valid ? (gated ? 401 : 200) : 404 };
	}

	try {
		await $fetch(`https://huggingface.co/api/datasets/${id}`, { timeout: 8000 });
		return { id, valid: true, gated: false, status: 200 };
	} catch (e) {
		const status =
			(e as { status?: number; statusCode?: number; response?: { status?: number } })?.status ??
			(e as { statusCode?: number })?.statusCode ??
			(e as { response?: { status?: number } })?.response?.status ??
			0;
		// 401 = the dataset exists but is gated/private (a HF token is needed to actually load it)
		return { id, valid: status === 200 || status === 401, gated: status === 401, status };
	}
});
