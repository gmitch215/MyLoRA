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
		// optional iconify id + color shown when there is no screenshot
		iconName: text('icon_name'),
		iconColor: text('icon_color'),
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
		// draft -> listed -> pushing -> published -> failed/archived; 'migrated' = imported from a cloudflare account
		status: text('status', {
			enum: ['draft', 'listed', 'pushing', 'published', 'failed', 'archived', 'migrated']
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

export const machines = sqliteTable(
	'machines',
	{
		id: text('id').primaryKey(),
		label: text('label').notNull(),
		ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
		// shared machines are usable by anyone who canTrain; personal ones only by the owner
		shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
		// generic host+port (a public ip, a cloud dns name, or an ngrok forwarding host) - never "ip"
		host: text('host').notNull(),
		port: integer('port').notNull().default(22),
		username: text('username').notNull(),
		authMethod: text('auth_method', { enum: ['key', 'password'] })
			.notNull()
			.default('key'),
		connectionType: text('connection_type', { enum: ['vps', 'tunnel'] })
			.notNull()
			.default('vps'),
		// envelope-encrypted private key (pkcs8 pem); null for password auth
		keyCipher: text('key_cipher'),
		keyIv: text('key_iv'),
		keyDekCipher: text('key_dek_cipher'),
		keyDekIv: text('key_dek_iv'),
		// envelope-encrypted key passphrase (optional)
		passphraseCipher: text('passphrase_cipher'),
		passphraseIv: text('passphrase_iv'),
		passphraseDekCipher: text('passphrase_dek_cipher'),
		passphraseDekIv: text('passphrase_dek_iv'),
		// envelope-encrypted ssh password; null for key auth
		passwordCipher: text('password_cipher'),
		passwordIv: text('password_iv'),
		passwordDekCipher: text('password_dek_cipher'),
		passwordDekIv: text('password_dek_iv'),
		// generated = we made the keypair in-worker; provided = user pasted their own key
		keySource: text('key_source', { enum: ['generated', 'provided'] }),
		// the public openssh line the user installs in authorized_keys (not secret)
		publicKey: text('public_key'),
		keyLast4: text('key_last4'),
		// pinned host key (tofu) - flags man-in-the-middle if it later changes
		hostKeyFingerprint: text('host_key_fingerprint'),
		hostKeyType: text('host_key_type'),
		// health snapshot from the last test/preflight
		healthStatus: text('health_status', {
			enum: ['unchecked', 'unknown', 'ok', 'unreachable', 'auth_failed', 'degraded']
		})
			.notNull()
			.default('unchecked'),
		lastDiagnosis: text('last_diagnosis'),
		lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
		// json {name, vramMb, vramUsedMb} from nvidia-smi (primary gpu)
		gpuInfo: text('gpu_info'),
		// json SystemInfo snapshot (cpu/ram/disk/os/user/all gpus) from the last preflight
		systemInfo: text('system_info'),
		toolingReady: integer('tooling_ready', { mode: 'boolean' }).notNull().default(false),
		// sha-256 hashed token a home box uses to self-report its current ngrok address
		selfReportTokenHash: text('self_report_token_hash'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [index('idx_machines_owner').on(t.ownerId)]
);

export const trainingJobs = sqliteTable(
	'training_jobs',
	{
		id: text('id').primaryKey(),
		machineId: text('machine_id').references(() => machines.id, { onDelete: 'set null' }),
		authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
		engine: text('engine', { enum: ['doc2lora', 'peft', 'accelerate'] }).notNull(),
		// queued -> provisioning -> launching -> running -> syncing -> verifying -> publishing -> completed
		// terminal: failed / abnormal / aborted
		status: text('status', {
			enum: [
				'queued',
				'provisioning',
				'launching',
				'running',
				'syncing',
				'verifying',
				'publishing',
				'completed',
				'failed',
				'abnormal',
				'aborted'
			]
		})
			.notNull()
			.default('queued'),
		statusMessage: text('status_message'),
		failureClass: text('failure_class', {
			enum: ['none', 'reported', 'abnormal', 'preflight', 'verify', 'sync', 'aborted', 'gated']
		})
			.notNull()
			.default('none'),
		// r2 ref for the uploaded dataset/docs
		datasetId: text('dataset_id'),
		inputKind: text('input_kind', { enum: ['documents', 'dataset'] })
			.notNull()
			.default('documents'),
		// full training config snapshot (json) so a settings change mid-run is not retroactive
		config: text('config').notNull(),
		autoPublish: integer('auto_publish', { mode: 'boolean' }).notNull().default(false),
		autoUploadFinetune: integer('auto_upload_finetune', { mode: 'boolean' })
			.notNull()
			.default(false),
		accountId: text('account_id').references(() => cloudflareAccounts.id, { onDelete: 'set null' }),
		// optional per-job huggingface token (gated models / private datasets), envelope-encrypted
		hfTokenCipher: text('hf_token_cipher'),
		hfTokenIv: text('hf_token_iv'),
		hfTokenDekCipher: text('hf_token_dek_cipher'),
		hfTokenDekIv: text('hf_token_dek_iv'),
		// true when the trained adapter is not CF-deployable (non-CF PEFT base): R2 download only
		downloadOnly: integer('download_only', { mode: 'boolean' }).notNull().default(false),
		// runtime state mirrored from the durable object
		pid: integer('pid'),
		pgid: integer('pgid'),
		wrapperId: text('wrapper_id'),
		jobDir: text('job_dir'),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
		lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }),
		lastProbeAt: integer('last_probe_at', { mode: 'timestamp_ms' }),
		// auto-expiring advisory lease: only one driver (cron / poll / DO alarm) advances a job at a time
		lockedAt: integer('locked_at', { mode: 'timestamp_ms' }),
		// json JobTelemetry: latest live box sample (cpu/ram/vram/disk/net/output size) from the probe
		telemetry: text('telemetry'),
		consecutiveFailures: integer('consecutive_failures').notNull().default(0),
		attempt: integer('attempt').notNull().default(0),
		nextPollAt: integer('next_poll_at', { mode: 'timestamp_ms' }),
		logTail: text('log_tail'),
		// result
		adapterId: text('adapter_id').references(() => adapters.id, { onDelete: 'set null' }),
		adapterSha: text('adapter_sha'),
		adapterSize: integer('adapter_size'),
		etaSeconds: integer('eta_seconds'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [
		index('idx_jobs_author').on(t.authorId),
		index('idx_jobs_machine').on(t.machineId),
		index('idx_jobs_status').on(t.status)
	]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type TrainingJob = typeof trainingJobs.$inferSelect;
export type NewTrainingJob = typeof trainingJobs.$inferInsert;
export type Adapter = typeof adapters.$inferSelect;
export type NewAdapter = typeof adapters.$inferInsert;
export type CloudflareAccount = typeof cloudflareAccounts.$inferSelect;
export type NewCloudflareAccount = typeof cloudflareAccounts.$inferInsert;
export type Download = typeof downloads.$inferSelect;
