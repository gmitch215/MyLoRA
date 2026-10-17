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

// an uploaded favicon is stored as a data url (about 2 MB for a real png); public responses carry
// these urls instead, which the /favicon.* routes serve
export const UPLOADED_FAVICON = {
	favicon: '/favicon.ico?v=custom',
	faviconPng: '/favicon.png?v=custom'
} as const;

export function toPublicSettings<T extends Record<string, unknown>>(settings: T): T {
	const out: Record<string, unknown> = { ...settings };
	for (const k of ['favicon', 'faviconPng'] as const) {
		const v = out[k];
		if (typeof v === 'string' && v.startsWith('data:')) out[k] = UPLOADED_FAVICON[k];
	}
	return out as T;
}

// structured keys stored as json
const JSON_KEYS = [
	'access',
	'permissions',
	'rateLimits',
	'limits',
	'tooling',
	'features',
	'message'
] as const;

function clampInt(value: number, min: number, max: number): number {
	const n = Math.trunc(Number(value));
	if (!Number.isFinite(n)) return min;
	return Math.min(Math.max(n, min), max);
}

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
	const stored = await getJson('permissions', DEFAULT_PERMISSIONS);
	return {
		developer: { ...DEFAULT_PERMISSIONS.developer, ...stored.developer },
		manager: { ...DEFAULT_PERMISSIONS.manager, ...stored.manager }
	};
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
	// spread defaults first: a stored blob written before a field existed would otherwise read undefined
	const l = { ...DEFAULT_LIMITS, ...(await getJson('limits', DEFAULT_LIMITS)) };
	const versusMin = clampInt(l.versusMinMessages, VERSUS_HARD_MIN, VERSUS_HARD_MAX);
	return {
		...l,
		maxWeightsBytes: Math.min(CF_MAX_WEIGHTS_BYTES, l.maxWeightsBytes),
		maxRank: Math.min(CF_MAX_RANK, l.maxRank),
		versusMinMessages: versusMin,
		// max can never fall below min, whatever was stored
		versusMaxMessages: clampInt(l.versusMaxMessages, versusMin, VERSUS_HARD_MAX)
	};
}

export async function getTooling(): Promise<ToolingSettings> {
	return mergeTooling(DEFAULT_TOOLING, await getJson<Partial<ToolingSettings>>('tooling', {}));
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
	const [access, permissions, rateLimits, limits, tooling, features, message] = await Promise.all([
		getAccess(),
		getPermissions(),
		getRateLimits(),
		getLimits(),
		getTooling(),
		getFeatures(),
		getJson<unknown>('message', null)
	]);
	return { ...strings, access, permissions, rateLimits, limits, tooling, features, message };
}

export async function setStringSetting(name: string, value: string) {
	await kv.set(key(name), value);
}

export async function setJsonSetting(name: (typeof JSON_KEYS)[number], value: unknown) {
	await kv.set(key(name), value as any);
}
