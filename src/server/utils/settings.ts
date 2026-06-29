const PREFIX = 'mylora:setting:';
const key = (k: string) => `${PREFIX}${k}`;

// branding/social keys stored as plain strings (nuxtpress style)
export const STRING_SETTING_KEYS = [
	'name',
	'description',
	'author',
	'bio',
	'themeColor',
	'favicon',
	'faviconPng',
	'website',
	'github',
	'twitter',
	'instagram',
	'patreon',
	'linkedin',
	'discord',
	'supportEmail'
] as const;

// structured keys stored as json
const JSON_KEYS = ['access', 'permissions', 'rateLimits', 'limits', 'features', 'message'] as const;

async function getJson<T>(name: string, fallback: T): Promise<T> {
	try {
		const raw = await kv.get<T>(key(name));
		return raw ? (raw as T) : fallback;
	} catch {
		return fallback;
	}
}

export async function getAccess(): Promise<AccessSettings> {
	return getJson('access', DEFAULT_ACCESS);
}

export async function getPermissions(): Promise<PermissionMatrix> {
	return getJson('permissions', DEFAULT_PERMISSIONS);
}

// public tier clamped to its ranges; developer tier never clamped
export async function getRateLimits(): Promise<RateLimits> {
	const rl = await getJson('rateLimits', DEFAULT_RATE_LIMITS);
	return {
		public: {
			promptsPerHour: clampPublicLimit('promptsPerHour', rl.public.promptsPerHour),
			outputTokensPerHour: clampPublicLimit('outputTokensPerHour', rl.public.outputTokensPerHour),
			precedence: rl.public.precedence
		},
		developer: rl.developer
	};
}

export async function getLimits(): Promise<LimitsSettings> {
	const l = await getJson('limits', DEFAULT_LIMITS);
	return {
		...l,
		maxWeightsBytes: Math.min(CF_MAX_WEIGHTS_BYTES, l.maxWeightsBytes),
		maxRank: Math.min(CF_MAX_RANK, l.maxRank)
	};
}

export async function getFeatures(): Promise<FeatureFlags> {
	return getJson('features', DEFAULT_FEATURES);
}

export async function getStringSetting(name: string): Promise<string | null> {
	try {
		return (await kv.get<string>(key(name))) ?? null;
	} catch {
		return null;
	}
}

// full settings object for the settings api + client store
export async function getAllSettings() {
	const strings: Record<string, string> = {};
	await Promise.all(
		STRING_SETTING_KEYS.map(async (k) => {
			const v = await getStringSetting(k);
			if (v != null) strings[k] = v;
		})
	);
	const [access, permissions, rateLimits, limits, features, message] = await Promise.all([
		getAccess(),
		getPermissions(),
		getRateLimits(),
		getLimits(),
		getFeatures(),
		getJson<unknown>('message', null)
	]);
	return { ...strings, access, permissions, rateLimits, limits, features, message };
}

export async function setStringSetting(name: string, value: string) {
	await kv.set(key(name), value);
}

export async function setJsonSetting(name: (typeof JSON_KEYS)[number], value: unknown) {
	await kv.set(key(name), value as any);
}
