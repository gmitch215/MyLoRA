export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canCreate');

	const body = await readBody(event).catch(() => null);
	const manifest = body?.manifest ?? body;
	if (!manifest || typeof manifest !== 'object') {
		throw createError({ statusCode: 400, statusMessage: 'A manifest object is required' });
	}

	const parsed = parseManifest(manifest);
	const validation = validateManifest(parsed);
	return { parsed, validation };
});
