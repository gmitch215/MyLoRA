const JSON_KEYS = ['access', 'permissions', 'rateLimits', 'limits', 'features', 'message'] as const;

export default defineEventHandler(async (event) => {
	await requireManager(event);

	const body = await readBody(event);
	const parsed = settingsSchema.safeParse(body ?? {});
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid settings data'),
			data: { issues: parsed.error.issues }
		});
	}

	const data = parsed.data as Record<string, unknown>;

	// branding/social string keys
	for (const k of STRING_SETTING_KEYS) {
		const v = data[k];
		if (typeof v === 'string') await setStringSetting(k, v);
	}

	// structured json keys (caps re-applied by the typed getters on read)
	for (const k of JSON_KEYS) {
		let v = data[k];
		if (v === undefined) continue;
		// a banner with blank text means "no banner" -> store null so an empty bar never renders
		if (k === 'message') {
			const text = (v as { text?: string } | null)?.text?.trim();
			v = text ? v : null;
		}
		await setJsonSetting(k, v);
	}

	await invalidateSettings();
	return await getAllSettings();
});
