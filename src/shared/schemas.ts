import * as z from 'zod';

export const CF_MAX_RANK = 32;
export const CF_MAX_WEIGHTS_BYTES = 300 * 1024 * 1024;

export const MODEL_TYPES = ['mistral', 'gemma', 'llama', 'qwen'] as const;
export const ROLES = ['administrator', 'manager', 'developer'] as const;
export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export const DEFAULT_BASE_MODELS: { model: string; modelType: (typeof MODEL_TYPES)[number] }[] = [
	{ model: '@cf/mistral/mistral-7b-instruct-v0.2-lora', modelType: 'mistral' },
	{ model: '@cf/google/gemma-7b-it-lora', modelType: 'gemma' },
	{ model: '@cf/google/gemma-2b-it-lora', modelType: 'gemma' },
	{ model: '@cf/meta-llama/llama-2-7b-chat-hf-lora', modelType: 'llama' },
	{ model: '@cf/meta/llama-3.2-11b-vision-instruct', modelType: 'llama' },
	{ model: '@cf/meta/llama-guard-3-8b', modelType: 'llama' },
	{ model: '@cf/google/gemma-3-12b-it', modelType: 'gemma' },
	{ model: '@cf/qwen/qwq-32b', modelType: 'qwen' },
	{ model: '@cf/qwen/qwen2.5-coder-32b-instruct', modelType: 'qwen' }
];

export const CONTEXT_WINDOWS: Record<string, number> = {
	'@cf/mistral/mistral-7b-instruct-v0.2-lora': 32768,
	'@cf/google/gemma-7b-it-lora': 8192,
	'@cf/google/gemma-2b-it-lora': 8192,
	'@cf/meta-llama/llama-2-7b-chat-hf-lora': 4096,
	'@cf/meta/llama-3.2-11b-vision-instruct': 131072,
	'@cf/meta/llama-guard-3-8b': 131072,
	'@cf/google/gemma-3-12b-it': 131072,
	'@cf/qwen/qwq-32b': 131072,
	'@cf/qwen/qwen2.5-coder-32b-instruct': 32768
};
export const DEFAULT_CONTEXT_WINDOW = 4096;

export function contextWindowFor(model: string): number {
	return CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

// rough token estimate (~4 chars/token) used for client-side context metering
export function estimateTokens(text: string): number {
	return Math.ceil((text || '').length / 4);
}

export const SLUG_RE = /^[a-z0-9-]+$/;
export const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;
export const RESERVED_USERNAMES = new Set(['me', 'admin', 'root', 'system', 'null', 'undefined']);

export const exampleSchema = z.object({
	input: z.string().min(1).max(2000),
	output: z.string().max(4000).optional().or(z.literal(''))
});

export const adapterSchema = z.object({
	name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
	slug: z
		.string()
		.min(1, 'Slug is required')
		.max(120, 'Slug must be 120 characters or less')
		.regex(SLUG_RE, 'Slug must only contain lowercase letters, numbers, and hyphens'),
	description: z
		.string()
		.max(20000, 'Description must be 20,000 characters or less')
		.optional()
		.or(z.literal('')),
	baseModel: z.string().min(1, 'Base model is required').max(200),
	modelType: z.enum(MODEL_TYPES),
	rank: z
		.number()
		.int('Rank must be a whole number')
		.min(1, 'Rank must be at least 1')
		.max(CF_MAX_RANK, `Rank must be ${CF_MAX_RANK} or less`),
	promptTemplate: z.string().max(8000).optional().or(z.literal('')),
	tags: z.array(z.string().max(50, 'Tag must be 50 characters or less')).max(20).default([]),
	examples: z.array(exampleSchema).max(20).default([]),
	// optional iconify id + color (nuxt color token or hex) used as the icon when no screenshot
	iconName: z.string().max(100).optional().or(z.literal('')),
	iconColor: z.string().max(40).optional().or(z.literal('')),
	visibility: z.enum(VISIBILITIES).default('public')
});

export const adapterCreateSchema = adapterSchema;

export const adapterUpdateSchema = adapterSchema.partial().extend({
	id: z.string().min(1, 'ID is required')
});

export const cloudflareAccountSchema = z.object({
	label: z.string().min(1, 'Label is required').max(80),
	accountId: z
		.string()
		.min(1, 'Account ID is required')
		.regex(/^[a-f0-9]{32}$/i, 'Account ID must be a 32-character hex string'),
	apiToken: z.string().min(20, 'API token looks too short').max(200),
	tokenScope: z.enum(['readwrite', 'readonly']).default('readwrite'),
	shared: z.boolean().default(false),
	isDefault: z.boolean().default(false)
});

export const cloudflareAccountUpdateSchema = z.object({
	label: z.string().min(1).max(80).optional(),
	apiToken: z.string().min(20).max(200).optional(),
	tokenScope: z.enum(['readwrite', 'readonly']).optional(),
	shared: z.boolean().optional(),
	isDefault: z.boolean().optional(),
	isActive: z.boolean().optional()
});

export const userCreateSchema = z.object({
	username: z
		.string()
		.regex(USERNAME_RE, 'Username must be 3-32 lowercase letters, numbers, hyphens, or underscores')
		.transform((v) => v.toLowerCase()),
	displayName: z
		.string()
		.min(1, 'Display name is required')
		.max(50, 'Display name must be 50 characters or less'),
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.max(128, 'Password must be 128 characters or less'),
	role: z.enum(ROLES),
	bio: z.string().max(500, 'Bio must be 500 characters or less').optional()
});

export const userUpdateSchema = z.object({
	username: z
		.string()
		.regex(USERNAME_RE, 'Username must be 3-32 lowercase letters, numbers, hyphens, or underscores')
		.transform((v) => v.toLowerCase())
		.optional(),
	displayName: z.string().min(1).max(50).optional(),
	role: z.enum(ROLES).optional(),
	bio: z.string().max(500).optional().or(z.literal('')),
	password: z.string().min(8).max(128).optional(),
	isActive: z.boolean().optional()
});

export const profileUpdateSchema = z.object({
	displayName: z.string().min(1).max(50).optional(),
	bio: z.string().max(500).optional().or(z.literal('')),
	currentPassword: z.string().min(1).optional(),
	newPassword: z.string().min(8).max(128).optional()
});

// permission matrix: per-role capability booleans (administrator is always all)
export const capabilitySchema = z.object({
	canCreate: z.boolean(),
	canEditOwn: z.boolean(),
	canEditAny: z.boolean(),
	canDeleteOwn: z.boolean(),
	canDeleteAny: z.boolean(),
	canPublish: z.boolean(),
	canManageAccounts: z.boolean(),
	unlimitedTester: z.boolean()
});

export const rateTierSchema = z.object({
	promptsPerHour: z.number().int().min(0),
	outputTokensPerHour: z.number().int().min(0),
	precedence: z.enum(['prompts', 'tokens'])
});

export const settingsSchema = z.object({
	// branding + social (ported from nuxtpress)
	name: z.string().max(50).optional(),
	description: z.string().max(160).optional(),
	author: z.string().max(50).optional(),
	bio: z.string().max(500).optional(),
	themeColor: z
		.string()
		.regex(/^#([0-9A-F]{3}){1,2}$/i, 'Theme color must be a valid hex color')
		.optional(),
	favicon: z.string().optional(),
	faviconPng: z.string().optional(),
	website: z.url('Must be a valid URL').optional().or(z.literal('')),
	github: z.string().optional(),
	twitter: z.string().optional(),
	instagram: z.string().optional(),
	patreon: z.string().optional(),
	linkedin: z.string().optional(),
	discord: z.string().optional().or(z.literal('')),
	supportEmail: z.email().max(255).optional().or(z.literal('')),
	// access control
	access: z
		.object({
			downloadAccess: z.enum(['public', 'login']),
			testerAccess: z.enum(['public', 'login']),
			defaultVisibility: z.enum(VISIBILITIES)
		})
		.optional(),
	// permission matrix (developer + manager configurable; administrator implicitly all)
	permissions: z
		.object({
			developer: capabilitySchema,
			manager: capabilitySchema
		})
		.optional(),
	// dual per-hour inference budgets
	rateLimits: z
		.object({
			public: rateTierSchema,
			developer: rateTierSchema
		})
		.optional(),
	// other former magic numbers (cf maxima are hard ceilings enforced server-side)
	limits: z
		.object({
			maxWeightsBytes: z.number().int().min(1).max(CF_MAX_WEIGHTS_BYTES),
			maxRank: z.number().int().min(1).max(CF_MAX_RANK),
			maxScreenshots: z.number().int().min(0).max(20),
			gridPageSize: z.number().int().min(6).max(60),
			accountBudgetPerMinute: z.number().int().min(1).max(2000),
			inferenceCacheTtl: z.number().int().min(0).max(3600),
			maxOutputTokens: z.number().int().min(16).max(4096),
			maxSystemPromptChars: z.number().int().min(0).max(8000)
		})
		.optional(),
	// feature flags for the stubbed cloudflare single-get/delete endpoints
	features: z
		.object({
			cfGetEnabled: z.boolean(),
			cfDeleteEnabled: z.boolean()
		})
		.optional(),
	// optional site-wide banner shown in the navbar
	message: z
		.object({
			text: z.string().min(1).max(300),
			icon: z.string().max(100).optional().or(z.literal('')),
			type: z.enum(['success', 'warning', 'error', 'info']),
			link: z.url().max(200).optional().or(z.literal(''))
		})
		.optional()
		.or(z.literal(null))
});

const FIELD_LABELS: Record<string, string> = {
	username: 'Username',
	displayName: 'Display name',
	password: 'Password',
	newPassword: 'New password',
	currentPassword: 'Current password',
	bio: 'Bio',
	role: 'Role',
	name: 'Name',
	slug: 'Slug',
	description: 'Description',
	baseModel: 'Base model',
	modelType: 'Model type',
	rank: 'Rank',
	tags: 'Tags',
	label: 'Label',
	accountId: 'Account ID',
	apiToken: 'API token'
};

export function firstZodIssueMessage(
	issues: { path: PropertyKey[]; message?: string }[] | undefined,
	fallback: string
): string {
	if (!issues || issues.length === 0) return fallback;
	const issue = issues[0]!;
	const pathKey = issue.path?.[0]?.toString();
	const label = pathKey ? (FIELD_LABELS[pathKey] ?? pathKey) : '';
	const message = issue.message && issue.message !== 'Invalid input' ? issue.message : fallback;
	return label ? `${label}: ${message}` : message;
}

export type AdapterInput = z.infer<typeof adapterSchema>;
export type AdapterCreateInput = z.infer<typeof adapterCreateSchema>;
export type AdapterUpdateInput = z.infer<typeof adapterUpdateSchema>;
export type CloudflareAccountInput = z.infer<typeof cloudflareAccountSchema>;
export type CloudflareAccountUpdateInput = z.infer<typeof cloudflareAccountUpdateSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type RateTier = z.infer<typeof rateTierSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type AdapterExample = z.infer<typeof exampleSchema>;
