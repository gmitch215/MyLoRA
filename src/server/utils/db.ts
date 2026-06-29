import { sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { kv } from 'hub:kv';

let isInitialized = false;
let initPromise: Promise<void> | null = null;

export const SETUP_COMPLETED_KV_KEY = 'mylora:setup_completed';

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

async function hasTable(name: string) {
	try {
		await db.run(sql.raw(`SELECT 1 FROM ${name} LIMIT 1`));
		return true;
	} catch {
		return false;
	}
}

// idempotent column migrations for tables that already exist (sqlite lacks ADD COLUMN IF NOT EXISTS);
// runs on every init so pre-existing databases pick up new columns
async function ensureColumns() {
	for (const [col, def] of [
		['icon_name', 'TEXT'],
		['icon_color', 'TEXT']
	] as const) {
		try {
			await db.run(sql.raw(`ALTER TABLE adapters ADD COLUMN ${col} ${def}`));
		} catch {
			// column already exists
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
			// probe every table so a missing one is recreated (createSchema is all IF NOT EXISTS)
			const ready =
				(await hasTable('users')) &&
				(await hasTable('cloudflare_accounts')) &&
				(await hasTable('adapters')) &&
				(await hasTable('downloads'));
			if (!ready) {
				console.log('initializing database...');
				await createSchema();
			}
			await ensureColumns();
			await legacyAdminSeed();
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
