import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		username: text('username').notNull(),
		displayName: text('display_name').notNull(),
		passwordHash: text('password_hash').notNull(),

		// administrator > manager > developer
		role: text('role', { enum: ['administrator', 'manager', 'developer'] }).notNull(),
		bio: text('bio'),
		avatarPathname: text('avatar_pathname'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [uniqueIndex('idx_users_username').on(t.username)]
);

export const cloudflareAccounts = sqliteTable(
	'cloudflare_accounts',
	{
		id: text('id').primaryKey(),
		label: text('label').notNull(),
		// cloudflare account id (not secret)
		accountId: text('account_id').notNull(),
		// envelope encryption: token encrypted with a per-record dek, dek wrapped with the KEK
		tokenCipher: text('token_cipher').notNull(),
		tokenIv: text('token_iv').notNull(),
		dekCipher: text('dek_cipher').notNull(),
		dekIv: text('dek_iv').notNull(),
		// for display only
		tokenLast4: text('token_last4'),
		tokenScope: text('token_scope', { enum: ['readwrite', 'readonly'] })
			.notNull()
			.default('readwrite'),
		ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
		// shared accounts are usable by all uploaders; personal ones only by the owner
		shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
		isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
		// cached count toward the 100-adapter cap
		adapterCount: integer('adapter_count').notNull().default(0),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [uniqueIndex('idx_cf_accounts_account_id').on(t.accountId)]
);

export const adapters = sqliteTable(
	'adapters',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		// eg @cf/mistralai/mistral-7b-instruct-v0.2-lora
		baseModel: text('base_model').notNull(),
		modelType: text('model_type', { enum: ['mistral', 'gemma', 'llama', 'qwen'] }).notNull(),
		// must be <= 32
		rank: integer('rank').notNull(),
		configBytes: integer('config_bytes').notNull().default(0),
		// must be < 300MB
		weightsBytes: integer('weights_bytes').notNull().default(0),
		promptTemplate: text('prompt_template'),
		// comma-joined, nuxtpress convention
		tags: text('tags'),
		// JSON array of {input, output}
		examples: text('examples'),
		// JSON array of r2 pathnames
		screenshots: text('screenshots'),
		visibility: text('visibility', { enum: ['public', 'unlisted', 'private'] })
			.notNull()
			.default('public'),
		// value sent to cloudflare finetune.public
		cfPublic: integer('cf_public', { mode: 'boolean' }).notNull().default(false),
		accountId: text('account_id').references(() => cloudflareAccounts.id, { onDelete: 'set null' }),
		// cloudflare finetune id, null until publish succeeds
		finetuneId: text('finetune_id'),
		// name used as the lora param at inference
		finetuneName: text('finetune_name'),
		authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
		// draft -> listed -> pushing -> published -> failed/archived
		status: text('status', {
			enum: ['draft', 'listed', 'pushing', 'published', 'failed', 'archived']
		})
			.notNull()
			.default('draft'),
		statusMessage: text('status_message'),
		downloadCount: integer('download_count').notNull().default(0),
		inferenceCount: integer('inference_count').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [
		uniqueIndex('idx_adapters_slug').on(t.slug),
		index('idx_adapters_author').on(t.authorId),
		index('idx_adapters_account').on(t.accountId),
		index('idx_adapters_visibility_created').on(t.visibility, t.createdAt),
		index('idx_adapters_base_model').on(t.baseModel),
		index('idx_adapters_status').on(t.status)
	]
);

export const downloads = sqliteTable(
	'downloads',
	{
		id: text('id').primaryKey(),
		adapterId: text('adapter_id').references(() => adapters.id, { onDelete: 'cascade' }),
		asset: text('asset', { enum: ['config', 'weights', 'bundle'] }).notNull(),
		// sha-256(ip + salt), nuxtpress analytics style
		ipHash: text('ip_hash'),
		// YYYY-MM-DD UTC for rollups
		day: text('day').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [index('idx_downloads_adapter_day').on(t.adapterId, t.day)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Adapter = typeof adapters.$inferSelect;
export type NewAdapter = typeof adapters.$inferInsert;
export type CloudflareAccount = typeof cloudflareAccounts.$inferSelect;
export type NewCloudflareAccount = typeof cloudflareAccounts.$inferInsert;
export type Download = typeof downloads.$inferSelect;
