import type { Capability, RateTier } from './schemas';

export type Role = 'administrator' | 'manager' | 'developer';
export type ModelType = 'mistral' | 'gemma' | 'llama' | 'qwen';
export type Visibility = 'public' | 'unlisted' | 'private';
export type AdapterStatus =
	| 'draft'
	| 'listed'
	| 'pushing'
	| 'published'
	| 'failed'
	| 'archived'
	| 'migrated';

// statuses whose adapters can be run in the widget + playground
export const TESTABLE_STATUSES: AdapterStatus[] = ['published', 'migrated'];
export function isTestable(status: AdapterStatus): boolean {
	return TESTABLE_STATUSES.includes(status);
}

export type PublicUser = {
	id: string;
	username: string;
	displayName: string;
	role: Role;
	avatarPathname?: string | null;
	bio?: string | null;
};

export type AdminUser = PublicUser & {
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
	adapterCount: number;
};

export type AdapterExampleItem = { input: string; output?: string };

export type Adapter = {
	id: string;
	name: string;
	slug: string;
	description?: string | null;
	baseModel: string;
	modelType: ModelType;
	rank: number;
	configBytes: number;
	weightsBytes: number;
	promptTemplate?: string | null;
	tags: string[];
	examples: AdapterExampleItem[];
	screenshots: string[];
	iconName?: string | null;
	iconColor?: string | null;
	visibility: Visibility;
	cfPublic: boolean;
	accountId?: string | null;
	finetuneId?: string | null;
	finetuneName?: string | null;
	authorId?: string | null;
	author?: PublicUser | null;
	status: AdapterStatus;
	statusMessage?: string | null;
	downloadCount: number;
	inferenceCount: number;
	created_at: Date;
	updated_at: Date;
};

// never includes the token; only the last4 for display
export type PublicCloudflareAccount = {
	id: string;
	label: string;
	accountId: string;
	tokenLast4?: string | null;
	tokenScope: 'readwrite' | 'readonly';
	ownerId?: string | null;
	shared: boolean;
	isDefault: boolean;
	adapterCount: number;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
};

export type PermissionMatrix = { developer: Capability; manager: Capability };
export type RateLimits = { public: RateTier; developer: RateTier };

export type AccessSettings = {
	downloadAccess: 'public' | 'login';
	testerAccess: 'public' | 'login';
	defaultVisibility: Visibility;
};

export type LimitsSettings = {
	maxWeightsBytes: number;
	maxRank: number;
	maxScreenshots: number;
	gridPageSize: number;
	accountBudgetPerMinute: number;
	inferenceCacheTtl: number;
	maxOutputTokens: number;
	maxSystemPromptChars: number;
};

export type FeatureFlags = { cfGetEnabled: boolean; cfDeleteEnabled: boolean };

export type PushJob = {
	phase: 'create' | 'config' | 'weights' | 'done' | 'error';
	progress: number;
	attempt: number;
	error?: string;
	ts: number;
};

export type InferenceResult = {
	response: string;
	outputTokens: number;
	cached?: boolean;
};

export function formatDate(date: Date | string) {
	return new Date(date).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
