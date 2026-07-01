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
		const v = data[k];
		if (v !== undefined) await setJsonSetting(k, v);
	}

	await invalidateSettings();
	return await getAllSettings();
});
