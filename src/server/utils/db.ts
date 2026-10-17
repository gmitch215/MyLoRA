import { sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { kv } from 'hub:kv';

let isInitialized = false;
let initPromise: Promise<void> | null = null;

export const SETUP_COMPLETED_KV_KEY = 'mylora:setup_completed';
// set once the schema+columns exist so cold worker isolates skip the probe + ALTER storm (which was
// ~17 sequential d1 round-trips per cold request); a single cheap kv read replaces it
export const SCHEMA_READY_KV_KEY = 'mylora:schema_ready';
// bump when createSchema/ensureColumns change: a flag from an older deploy no longer matches, so the
// next cold isolate re-runs the idempotent migration instead of skipping the new columns forever
export const SCHEMA_VERSION = '5';

export async function markSetupCompleted() {
	try {
		await kv.set(SETUP_COMPLETED_KV_KEY, '1');
	} catch (error) {
		console.warn('failed to set setup completion flag:', error);
	}
}

export function describeDbError(error: unknown): string {
	// drizzle wraps libsql wraps the actual D1 reason; walk the chain so we surface the real cause
	const seen = new Set<unknown>();
	let current: any = error;
	let best: { msg: string; code?: string } | null = null;
	while (current && !seen.has(current)) {
		seen.add(current);
		const msg = current?.message || (typeof current === 'string' ? current : undefined);
		const code = current?.code || current?.libsqlError?.code;
		if (msg && (!best || msg.length < best.msg.length || code)) {
			best = { msg, code };
		}
		current = current?.cause;
	}
	if (best) return best.code ? `${best.msg} [${best.code}]` : best.msg;
	return String(error);
}

// idempotent column migrations for tables that already exist (sqlite lacks ADD COLUMN IF NOT EXISTS);
// runs on every init so pre-existing databases pick up new columns
async function ensureColumns() {
	for (const [col, def] of [
		['icon_name', 'TEXT'],
		['icon_color', 'TEXT'],
		['endpoint_id', 'TEXT'],
		['endpoint_model', 'TEXT']
	] as const) {
		try {
			await db.run(sql.raw(`ALTER TABLE adapters ADD COLUMN ${col} ${def}`));
		} catch {
			// column already exists
		}
	}

	// training_jobs columns added after the table first shipped
	for (const [col, def] of [
		['hf_token_cipher', 'TEXT'],
		['hf_token_iv', 'TEXT'],
		['hf_token_dek_cipher', 'TEXT'],
		['hf_token_dek_iv', 'TEXT'],
		['download_only', 'INTEGER NOT NULL DEFAULT 0'],
		['locked_at', 'INTEGER'],
		['telemetry', 'TEXT'],
		['notified_at', 'INTEGER']
	] as const) {
		try {
			await db.run(sql.raw(`ALTER TABLE training_jobs ADD COLUMN ${col} ${def}`));
		} catch {
			// column already exists or table not yet created (createSchema covers fresh dbs)
		}
	}
	// users columns added after the table first shipped
	for (const [col, def] of [
		['email', 'TEXT'],
		['email_confirmed_at', 'INTEGER'],
		['notify_jobs', 'INTEGER NOT NULL DEFAULT 0']
	] as const) {
		try {
			await db.run(sql.raw(`ALTER TABLE users ADD COLUMN ${col} ${def}`));
		} catch {
			// column already exists
		}
	}
	// machines columns added after the table first shipped
	for (const [col, def] of [
		['system_info', 'TEXT'],
		['tooling', 'TEXT']
	] as const) {
		try {
			await db.run(sql.raw(`ALTER TABLE machines ADD COLUMN ${col} ${def}`));
		} catch {
			// column already exists or table not yet created
		}
	}
}

async function createSchema() {
	await db.run(sql`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			display_name TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL,
			bio TEXT,
			avatar_pathname TEXT,
			email TEXT,
			email_confirmed_at INTEGER,
			notify_jobs INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS cloudflare_accounts (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			account_id TEXT NOT NULL,
			token_cipher TEXT NOT NULL,
			token_iv TEXT NOT NULL,
			dek_cipher TEXT NOT NULL,
			dek_iv TEXT NOT NULL,
			token_last4 TEXT,
			token_scope TEXT NOT NULL DEFAULT 'readwrite',
			owner_id TEXT,
			shared INTEGER NOT NULL DEFAULT 0,
			is_default INTEGER NOT NULL DEFAULT 0,
			adapter_count INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_accounts_account_id ON cloudflare_accounts(account_id)`
	);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS adapters (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			description TEXT,
			base_model TEXT NOT NULL,
			model_type TEXT NOT NULL,
			rank INTEGER NOT NULL,
			config_bytes INTEGER NOT NULL DEFAULT 0,
			weights_bytes INTEGER NOT NULL DEFAULT 0,
			prompt_template TEXT,
			tags TEXT,
			examples TEXT,
			screenshots TEXT,
			icon_name TEXT,
			icon_color TEXT,
			visibility TEXT NOT NULL DEFAULT 'public',
			cf_public INTEGER NOT NULL DEFAULT 0,
			account_id TEXT,
			finetune_id TEXT,
			finetune_name TEXT,
			endpoint_id TEXT,
			endpoint_model TEXT,
			author_id TEXT,
			status TEXT NOT NULL DEFAULT 'draft',
			status_message TEXT,
			download_count INTEGER NOT NULL DEFAULT 0,
			inference_count INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_adapters_slug ON adapters(slug)`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_adapters_author ON adapters(author_id)`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_adapters_account ON adapters(account_id)`);
	await db.run(
		sql`CREATE INDEX IF NOT EXISTS idx_adapters_visibility_created ON adapters(visibility, created_at)`
	);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_adapters_base_model ON adapters(base_model)`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_adapters_status ON adapters(status)`);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS downloads (
			id TEXT PRIMARY KEY,
			adapter_id TEXT,
			asset TEXT NOT NULL,
			ip_hash TEXT,
			day TEXT NOT NULL,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(
		sql`CREATE INDEX IF NOT EXISTS idx_downloads_adapter_day ON downloads(adapter_id, day)`
	);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS machines (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			owner_id TEXT,
			shared INTEGER NOT NULL DEFAULT 0,
			host TEXT NOT NULL,
			port INTEGER NOT NULL DEFAULT 22,
			username TEXT NOT NULL,
			auth_method TEXT NOT NULL DEFAULT 'key',
			connection_type TEXT NOT NULL DEFAULT 'vps',
			key_cipher TEXT,
			key_iv TEXT,
			key_dek_cipher TEXT,
			key_dek_iv TEXT,
			passphrase_cipher TEXT,
			passphrase_iv TEXT,
			passphrase_dek_cipher TEXT,
			passphrase_dek_iv TEXT,
			password_cipher TEXT,
			password_iv TEXT,
			password_dek_cipher TEXT,
			password_dek_iv TEXT,
			key_source TEXT,
			public_key TEXT,
			key_last4 TEXT,
			host_key_fingerprint TEXT,
			host_key_type TEXT,
			health_status TEXT NOT NULL DEFAULT 'unchecked',
			last_diagnosis TEXT,
			last_checked_at INTEGER,
			gpu_info TEXT,
			system_info TEXT,
			tooling TEXT,
			tooling_ready INTEGER NOT NULL DEFAULT 0,
			self_report_token_hash TEXT,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_machines_owner ON machines(owner_id)`);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS training_jobs (
			id TEXT PRIMARY KEY,
			machine_id TEXT,
			author_id TEXT,
			engine TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'queued',
			status_message TEXT,
			failure_class TEXT NOT NULL DEFAULT 'none',
			dataset_id TEXT,
			input_kind TEXT NOT NULL DEFAULT 'documents',
			config TEXT NOT NULL,
			auto_publish INTEGER NOT NULL DEFAULT 0,
			auto_upload_finetune INTEGER NOT NULL DEFAULT 0,
			account_id TEXT,
			hf_token_cipher TEXT,
			hf_token_iv TEXT,
			hf_token_dek_cipher TEXT,
			hf_token_dek_iv TEXT,
			download_only INTEGER NOT NULL DEFAULT 0,
			pid INTEGER,
			pgid INTEGER,
			wrapper_id TEXT,
			job_dir TEXT,
			started_at INTEGER,
			finished_at INTEGER,
			last_heartbeat_at INTEGER,
			last_probe_at INTEGER,
			locked_at INTEGER,
			telemetry TEXT,
			consecutive_failures INTEGER NOT NULL DEFAULT 0,
			attempt INTEGER NOT NULL DEFAULT 0,
			next_poll_at INTEGER,
			log_tail TEXT,
			adapter_id TEXT,
			adapter_sha TEXT,
			adapter_size INTEGER,
			eta_seconds INTEGER,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_jobs_author ON training_jobs(author_id)`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_jobs_machine ON training_jobs(machine_id)`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON training_jobs(status)`);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS subscribers (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			confirmed_at INTEGER,
			confirmation_sent_at INTEGER
		)
	`);
	await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email)`);
	await db.run(sql`
		CREATE TABLE IF NOT EXISTS mail_outbox (
			id TEXT PRIMARY KEY,
			subscriber_id TEXT NOT NULL,
			adapter_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			attempts INTEGER NOT NULL DEFAULT 0,
			error TEXT,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(
		sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_outbox_subscriber_adapter ON mail_outbox(subscriber_id, adapter_id)`
	);
	await db.run(
		sql`CREATE INDEX IF NOT EXISTS idx_mail_outbox_status_updated ON mail_outbox(status, updated_at)`
	);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS inference_endpoints (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			owner_id TEXT,
			shared INTEGER NOT NULL DEFAULT 0,
			source TEXT NOT NULL DEFAULT 'external',
			base_url TEXT NOT NULL DEFAULT '',
			default_model TEXT,
			key_cipher TEXT,
			key_iv TEXT,
			key_dek_cipher TEXT,
			key_dek_iv TEXT,
			key_last4 TEXT,
			is_active INTEGER NOT NULL DEFAULT 1,
			health TEXT NOT NULL DEFAULT 'unchecked',
			last_diagnosis TEXT,
			last_checked_at INTEGER,
			machine_id TEXT,
			serve_status TEXT,
			serve_config TEXT,
			secrets_cipher TEXT,
			secrets_iv TEXT,
			secrets_dek_cipher TEXT,
			secrets_dek_iv TEXT,
			pid INTEGER,
			log_tail TEXT,
			locked_at INTEGER,
			next_poll_at INTEGER,
			started_at INTEGER,
			stopped_at INTEGER,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(
		sql`CREATE INDEX IF NOT EXISTS idx_endpoints_owner ON inference_endpoints(owner_id)`
	);
	await db.run(
		sql`CREATE INDEX IF NOT EXISTS idx_endpoints_serve_status ON inference_endpoints(serve_status)`
	);

	await db.run(sql`
		CREATE TABLE IF NOT EXISTS ngrok_tokens (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			token_cipher TEXT NOT NULL,
			token_iv TEXT NOT NULL,
			dek_cipher TEXT NOT NULL,
			dek_iv TEXT NOT NULL,
			token_last4 TEXT,
			owner_id TEXT,
			shared INTEGER NOT NULL DEFAULT 0,
			is_default INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
			updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	await db.run(sql`CREATE INDEX IF NOT EXISTS idx_ngrok_tokens_owner ON ngrok_tokens(owner_id)`);
}

async function legacyAdminSeed() {
	// optional bootstrap: seed an admin from NUXT_PASSWORD when no users exist yet
	const config = useRuntimeConfig();
	const password = config.password;
	if (!password || password === 'password') return;

	try {
		const existing = await db.run(sql`SELECT id FROM users WHERE username = ${'admin'} LIMIT 1`);
		if (existing.rows?.[0]) {
			await markSetupCompleted();
			return;
		}
		const id = crypto.randomUUID().replace(/-/g, '');
		const hash = await hashPassword(password);
		const now = Date.now();
		await db.run(sql`
			INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, avatar_pathname, is_active, created_at, updated_at)
			VALUES (${id}, ${'admin'}, ${'Team'}, ${hash}, ${'administrator'}, ${'/_favicon.png'}, ${1}, ${now}, ${now})
		`);
		await markSetupCompleted();
		console.log('seeded admin user from NUXT_PASSWORD');
	} catch (error) {
		console.warn('legacy admin seed skipped:', describeDbError(error));
	}
}

export async function ensureDatabase() {
	if (isInitialized) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			// fast path: a prior request/deploy already built the schema, so skip the expensive probe +
			// ALTER storm entirely (one kv read instead of ~17 d1 round-trips on a cold isolate)
			let schemaReady = false;
			try {
				schemaReady = (await kv.get(SCHEMA_READY_KV_KEY)) === SCHEMA_VERSION;
			} catch {
				// kv unavailable -> fall through to the full migration
			}
			if (!schemaReady) {
				// every statement is idempotent, so the whole migration is safe to re-run
				await createSchema();
				await ensureColumns();
				await legacyAdminSeed();
				try {
					await kv.set(SCHEMA_READY_KV_KEY, SCHEMA_VERSION);
				} catch {
					// non-fatal: we just re-probe next cold isolate
				}
			}
			isInitialized = true;
		} catch (error: any) {
			console.error('database init error:', describeDbError(error));
			throw error;
		}
	})();

	try {
		await initPromise;
	} finally {
		initPromise = null;
	}
}

export async function userCount(): Promise<number> {
	await ensureDatabase();
	const res = await db.run(sql`SELECT COUNT(*) as count FROM users`);
	return Number((res.rows?.[0] as any)?.count ?? 0);
}
