// validate a huggingface model id (keyless): 200 = ok, 401/403 = gated, 404 = missing. drives the
// launch modal's non-blocking gated-access warning
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	const id = String(getQuery(event).id || '').trim();
	if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing model id' });

	if (isMockSsh()) {
		const valid = !id.includes('missing');
		const gated = valid && /gated|llama|gemma|mistral/i.test(id);
		return { id, valid, gated, status: valid ? (gated ? 401 : 200) : 404 };
	}

	try {
		await $fetch(`https://huggingface.co/api/models/${id}`, { timeout: 8000 });
		return { id, valid: true, gated: false, status: 200 };
	} catch (e) {
		const status =
			(e as { status?: number; statusCode?: number; response?: { status?: number } })?.status ??
			(e as { statusCode?: number })?.statusCode ??
			(e as { response?: { status?: number } })?.response?.status ??
			0;
		const gated = status === 401 || status === 403;
		return { id, valid: status === 200 || gated, gated, status };
	}
});
