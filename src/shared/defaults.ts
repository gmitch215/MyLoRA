import {
	CF_MAX_RANK,
	CF_MAX_WEIGHTS_BYTES,
	DEFAULT_VERSUS_MAX_MESSAGES,
	DEFAULT_VERSUS_MIN_MESSAGES,
	toolingSettingsSchema,
	type Capability
} from './schemas';
import type {
	AccessSettings,
	FeatureFlags,
	LimitsSettings,
	MachineTooling,
	PermissionMatrix,
	RateLimits,
	Role,
	ToolingSettings
} from './types';

// administrator always has every capability; this is the implicit top of the matrix
export const ADMIN_CAPABILITY: Capability = {
	canCreate: true,
	canEditOwn: true,
	canEditAny: true,
	canDeleteOwn: true,
	canDeleteAny: true,
	canPublish: true,
	canManageAccounts: true,
	canManageMachines: true,
	canTrain: true,
	unlimitedTester: true
};

export const DEFAULT_PERMISSIONS: PermissionMatrix = {
	developer: {
		canCreate: true,
		canEditOwn: true,
		canEditAny: false,
		canDeleteOwn: false,
		canDeleteAny: false,
		canPublish: false,
		canManageAccounts: false,
		canManageMachines: false,
		canTrain: true,
		unlimitedTester: false
	},
	manager: {
		canCreate: true,
		canEditOwn: true,
		canEditAny: true,
		canDeleteOwn: false,
		canDeleteAny: false,
		canPublish: true,
		canManageAccounts: true,
		canManageMachines: true,
		canTrain: true,
		unlimitedTester: true
	}
};

export const DEFAULT_ACCESS: AccessSettings = {
	downloadAccess: 'public',
	testerAccess: 'public',
	defaultVisibility: 'public'
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
	public: { promptsPerHour: 3, outputTokensPerHour: 1600, precedence: 'tokens' },
	developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
};

// public tier is clamped to these bounds; developer tier is never clamped
export const PUBLIC_LIMIT_RANGES = {
	promptsPerHour: { min: 1, max: 10 },
	outputTokensPerHour: { min: 1000, max: 10000 }
};

export const DEFAULT_LIMITS: LimitsSettings = {
	maxWeightsBytes: CF_MAX_WEIGHTS_BYTES,
	maxRank: CF_MAX_RANK,
	maxScreenshots: 6,
	gridPageSize: 24,
	accountBudgetPerMinute: 300,
	inferenceCacheTtl: 60,
	maxOutputTokens: 512,
	maxSystemPromptChars: 2000,
	versusMinMessages: DEFAULT_VERSUS_MIN_MESSAGES,
	versusMaxMessages: DEFAULT_VERSUS_MAX_MESSAGES,
	logRetentionDays: 90
};

// vllm 0.31.0 is the PyPI release of 2026-10-05; cloudflared 2026.10.0 has built-in checksums
// (server/utils/tooling.ts); both were chosen from release dates and not run on real hardware
export const DEFAULT_TOOLING: ToolingSettings = {
	autoInstall: true,
	pythonVersion: '3.11',
	vllmVersion: '0.31.0',
	cloudflaredVersion: '2026.10.0',
	downloadRetries: 5,
	networkWaitMinutes: 10,
	bandwidthLimitKbps: 0
};

/** Layers an override onto a base, keeping the base for any field that is missing or invalid. */
export function mergeTooling(
	base: ToolingSettings,
	override: MachineTooling | null | undefined
): ToolingSettings {
	const out: Record<string, unknown> = { ...base };
	if (!override) return out as ToolingSettings;
	for (const key of Object.keys(toolingSettingsSchema.shape) as (keyof ToolingSettings)[]) {
		const value = override[key];
		if (value === undefined || value === null) continue;
		const checked = toolingSettingsSchema.shape[key].safeParse(value);
		if (checked.success) out[key] = checked.data;
	}
	return out as ToolingSettings;
}

export const DEFAULT_FEATURES: FeatureFlags = {
	cfGetEnabled: false,
	cfDeleteEnabled: false
};

export function capabilityFor(role: Role, permissions: PermissionMatrix): Capability {
	if (role === 'administrator') return ADMIN_CAPABILITY;
	return permissions[role];
}

// clamp a public-tier number into its configured range
export function clampPublicLimit(
	field: 'promptsPerHour' | 'outputTokensPerHour',
	value: number
): number {
	const r = PUBLIC_LIMIT_RANGES[field];
	return Math.max(r.min, Math.min(r.max, value));
}
