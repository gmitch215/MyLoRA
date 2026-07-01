import * as z from 'zod';

export const CF_MAX_RANK = 32;
export const CF_MAX_WEIGHTS_BYTES = 300 * 1024 * 1024;

export const MODEL_TYPES = ['mistral', 'gemma', 'llama', 'qwen'] as const;
export const ROLES = ['administrator', 'manager', 'developer'] as const;
export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export const DEFAULT_BASE_MODELS: {
	model: string;
	modelType: (typeof MODEL_TYPES)[number];
	hfModel: string;
}[] = [
	{
		model: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
		modelType: 'mistral',
		hfModel: 'mistralai/Mistral-7B-Instruct-v0.2'
	},
	{ model: '@cf/google/gemma-7b-it-lora', modelType: 'gemma', hfModel: 'google/gemma-7b-it' },
	{ model: '@cf/google/gemma-2b-it-lora', modelType: 'gemma', hfModel: 'google/gemma-2b-it' },
	{
		model: '@cf/meta-llama/llama-2-7b-chat-hf-lora',
		modelType: 'llama',
		hfModel: 'meta-llama/Llama-2-7b-chat-hf'
	},
	{
		model: '@cf/meta/llama-3.2-11b-vision-instruct',
		modelType: 'llama',
		hfModel: 'meta-llama/Llama-3.2-11B-Vision-Instruct'
	},
	{
		model: '@cf/meta/llama-guard-3-8b',
		modelType: 'llama',
		hfModel: 'meta-llama/Llama-Guard-3-8B'
	},
	{ model: '@cf/google/gemma-3-12b-it', modelType: 'gemma', hfModel: 'google/gemma-3-12b-it' },
	{ model: '@cf/qwen/qwq-32b', modelType: 'qwen', hfModel: 'Qwen/QwQ-32B' },
	{
		model: '@cf/qwen/qwen2.5-coder-32b-instruct',
		modelType: 'qwen',
		hfModel: 'Qwen/Qwen2.5-Coder-32B-Instruct'
	}
];

// resolve the HuggingFace repo id used to TRAIN against `model`. a curated Cloudflare base maps to its
// hfModel; any other id (a free-typed HF repo for peft/accelerate) passes through unchanged.
export function hfModelFor(model: string): string {
	return DEFAULT_BASE_MODELS.find((m) => m.model === model)?.hfModel ?? model;
}

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
	// add/edit/delete remote training machines + their connection secrets
	canManageMachines: z.boolean(),
	// launch training jobs on a machine
	canTrain: z.boolean(),
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
			maxSystemPromptChars: z.number().int().min(0).max(8000),
			// days to keep training logs (+ download-only artifacts) in R2 before the cleanup pass purges them
			logRetentionDays: z.number().int().min(7).max(365)
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

export const TRAINING_ENGINES = ['doc2lora', 'peft', 'accelerate'] as const;
export const TRAINING_DEVICES = ['auto', 'cuda', 'mps', 'cpu'] as const;
export const CONNECTION_TYPES = ['vps', 'tunnel'] as const;
export const AUTH_METHODS = ['key', 'password'] as const;

// a unix username + a sane host (hostname or ip); kept permissive, validated harder at connect time
const USERNAME_SSH_RE = /^[a-z_][a-z0-9_-]{0,31}$/i;
const HOST_RE = /^[a-z0-9.-]{1,253}$/i;

export const machineCreateSchema = z
	.object({
		label: z.string().min(1, 'Label is required').max(80),
		host: z.string().min(1, 'Host is required').max(253).regex(HOST_RE, 'Host looks invalid'),
		port: z.number().int().min(1).max(65535).default(22),
		username: z
			.string()
			.min(1, 'Username is required')
			.max(32)
			.regex(USERNAME_SSH_RE, 'Username looks invalid'),
		connectionType: z.enum(CONNECTION_TYPES).default('vps'),
		shared: z.boolean().default(false),
		authMethod: z.enum(AUTH_METHODS).default('key'),
		// generated = we make the keypair; provided = user pastes a private key
		keySource: z.enum(['generated', 'provided']).default('generated'),
		privateKey: z.string().max(20000).optional().or(z.literal('')),
		passphrase: z.string().max(400).optional().or(z.literal('')),
		password: z.string().max(400).optional().or(z.literal(''))
	})
	.refine((v) => v.authMethod !== 'password' || (v.password && v.password.length > 0), {
		message: 'Password is required for password authentication',
		path: ['password']
	})
	.refine(
		(v) =>
			v.authMethod !== 'key' ||
			v.keySource === 'generated' ||
			(v.privateKey && v.privateKey.length > 0),
		{ message: 'Paste a private key or choose a generated key', path: ['privateKey'] }
	);

export const machineUpdateSchema = z.object({
	label: z.string().min(1).max(80).optional(),
	host: z.string().min(1).max(253).regex(HOST_RE).optional(),
	port: z.number().int().min(1).max(65535).optional(),
	username: z.string().min(1).max(32).regex(USERNAME_SSH_RE).optional(),
	connectionType: z.enum(CONNECTION_TYPES).optional(),
	shared: z.boolean().optional(),
	isActive: z.boolean().optional(),
	// secrets are update-only: a blank value keeps the stored one
	privateKey: z.string().max(20000).optional().or(z.literal('')),
	passphrase: z.string().max(400).optional().or(z.literal('')),
	password: z.string().max(400).optional().or(z.literal(''))
});

// a home box self-reporting its current ngrok address to auto-heal the stored endpoint
export const tunnelSelfReportSchema = z.object({
	token: z.string().min(16).max(200),
	host: z.string().min(1).max(253).regex(HOST_RE),
	port: z.number().int().min(1).max(65535)
});

// detect the cloudflare lora family from a (possibly free-text HF) model id; null = not
// CF-deployable, so a PEFT adapter on that base is download-only
export function detectModelType(model: string): (typeof MODEL_TYPES)[number] | null {
	const m = (model || '').toLowerCase();
	if (m.includes('qwen') || m.includes('qwq')) return 'qwen';
	if (m.includes('gemma')) return 'gemma';
	if (m.includes('mistral')) return 'mistral';
	if (m.includes('llama')) return 'llama';
	return null;
}

// the full training config (snapshotted onto the job so later settings changes are not retroactive).
// modelType is optional: doc2lora sets it from the curated CF base; PEFT derives it from the (free)
// HF base via detectModelType (may be null -> download-only)
export const trainingConfigSchema = z.object({
	baseModel: z.string().min(1).max(200),
	modelType: z.enum(MODEL_TYPES).optional(),
	rank: z.number().int().min(1).max(CF_MAX_RANK).default(8),
	loraAlpha: z.number().int().min(1).max(256).default(16),
	loraDropout: z.number().min(0).max(0.9).default(0.1),
	epochs: z.number().int().min(1).max(20).default(3),
	learningRate: z.number().min(0.000001).max(0.01).default(0.0005),
	maxLength: z.number().int().min(16).max(4096).default(512),
	batchSize: z.number().int().min(1).max(32).default(4),
	gradientAccumulationSteps: z.number().int().min(1).max(64).default(1),
	load4bit: z.boolean().default(false),
	device: z.enum(TRAINING_DEVICES).default('auto'),
	// peft target modules; empty = auto-detect
	targetModules: z.array(z.string().max(40)).max(16).default([]),
	// peft: load training data from a huggingface dataset (no upload)
	hfDataset: z.string().max(200).optional().or(z.literal('')),
	hfConfig: z.string().max(100).optional().or(z.literal('')),
	hfSplit: z.string().max(60).default('train'),
	// one text column, or a {column} format template to build each training example
	textField: z.string().max(100).optional().or(z.literal('')),
	textTemplate: z.string().max(2000).optional().or(z.literal('')),
	// accelerate (diffusers text-to-image LoRA): caption column + image resolution + step budget
	captionColumn: z.string().max(100).optional().or(z.literal('')),
	resolution: z.number().int().min(64).max(2048).default(512),
	maxSteps: z.number().int().min(1).max(200000).optional(),
	// optional advanced override: a user-supplied peft python script instead of the generated one
	pythonFile: z.string().max(100000).optional().or(z.literal('')),
	abortOnError: z.boolean().default(true),
	// doc2lora parser scope: core (plain text only, smallest) / docs (default: pdf/office/html/etc) /
	// all (adds audio+video ingestion, but pulls numba/llvmlite which cannot build on python >= 3.13)
	doc2loraExtras: z.enum(['core', 'docs', 'all']).default('docs'),
	// run isolation: a python venv is created on the box (default on); pythonVersion drives uv
	useVenv: z.boolean().default(true),
	pythonVersion: z
		.string()
		.max(20)
		.regex(/^\d+(\.\d+){0,2}$/, 'Use a version like 3.11')
		.default('3.11'),
	// run the training process under sudo (the password is supplied per-launch via sudoPassword, never
	// stored on the job); off by default
	useSudo: z.boolean().default(false),
	// optional custom output adapter name + slug; empty -> server defaults ("<machine> adapter" /
	// "trained-<id>"). slug validated to the same lowercase-hyphen shape as an adapter slug
	outputName: z.string().max(100).optional().or(z.literal('')),
	outputSlug: z
		.string()
		.max(120)
		.regex(SLUG_RE, 'Slug must only contain lowercase letters, numbers, and hyphens')
		.optional()
		.or(z.literal(''))
});

export const trainingJobCreateSchema = z
	.object({
		machineId: z.string().min(1, 'Machine is required'),
		engine: z.enum(TRAINING_ENGINES),
		// doc2lora: an uploaded documents/dataset bundle in R2
		datasetId: z.string().optional().or(z.literal('')),
		inputKind: z.enum(['documents', 'dataset']).default('documents'),
		config: trainingConfigSchema,
		autoPublish: z.boolean().default(false),
		autoUploadFinetune: z.boolean().default(false),
		accountId: z.string().optional(),
		// optional per-job huggingface token (gated models / private datasets); envelope-encrypted
		hfToken: z.string().max(400).optional().or(z.literal('')),
		// ephemeral sudo creds (only when config.useSudo): held transiently to prime the launch, NEVER
		// written to the job record. the username defaults to the ssh user, the password to the ssh
		// password server-side; both must be re-supplied on every launch/retry/restart
		sudoUser: z
			.string()
			.max(32)
			.regex(/^[a-z_][a-z0-9_-]*$/i, 'Username looks invalid')
			.optional()
			.or(z.literal('')),
		sudoPassword: z.string().max(400).optional().or(z.literal(''))
	})
	.refine((v) => v.engine !== 'doc2lora' || (v.datasetId && v.datasetId.length > 0), {
		message: 'Upload documents or a dataset for doc2lora',
		path: ['datasetId']
	})
	.refine((v) => v.engine === 'doc2lora' || (v.config.hfDataset && v.config.hfDataset.length > 0), {
		message: 'A HuggingFace dataset id is required',
		path: ['config', 'hfDataset']
	});

export type MachineCreateInput = z.infer<typeof machineCreateSchema>;
export type MachineUpdateInput = z.infer<typeof machineUpdateSchema>;
export type TunnelSelfReportInput = z.infer<typeof tunnelSelfReportSchema>;
export type TrainingConfigInput = z.infer<typeof trainingConfigSchema>;
export type TrainingJobCreateInput = z.infer<typeof trainingJobCreateSchema>;

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
