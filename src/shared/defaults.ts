import { CF_MAX_RANK, CF_MAX_WEIGHTS_BYTES, type Capability } from './schemas';
import type {
	AccessSettings,
	FeatureFlags,
	LimitsSettings,
	PermissionMatrix,
	RateLimits,
	Role
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
	maxSystemPromptChars: 2000
};

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
