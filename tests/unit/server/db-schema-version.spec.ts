import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn().mockResolvedValue({ rows: [] });
const kvGet = vi.fn();
const kvSet = vi.fn().mockResolvedValue(undefined);

vi.mock('hub:db', () => ({ db: { run } }));
vi.mock('hub:kv', () => ({ kv: { get: kvGet, set: kvSet } }));
vi.stubGlobal('useRuntimeConfig', () => ({ password: 'password' }));

// drizzle's sql tag yields chunks; flatten them back to the statement text
function textOf(call: unknown[]): string {
	const q = call[0] as { queryChunks?: { value?: string[] }[] };
	return (q.queryChunks ?? []).flatMap((c) => c.value ?? []).join('');
}

async function load() {
	vi.resetModules();
	return import('../../../src/server/utils/db');
}

describe('ensureDatabase schema version flag', () => {
	beforeEach(() => {
		run.mockClear();
		kvGet.mockReset();
		kvSet.mockClear();
	});

	it('re-runs the idempotent migration when the flag is from an older deploy', async () => {
		kvGet.mockResolvedValue('1');
		const { ensureDatabase, SCHEMA_READY_KV_KEY, SCHEMA_VERSION } = await load();
		await ensureDatabase();

		const statements = run.mock.calls.map(textOf).concat(
			// ensureColumns uses sql.raw, whose text is on the raw query object
			run.mock.calls.map((c) => JSON.stringify(c[0]))
		);
		expect(statements.join('\n')).toContain('ALTER TABLE users ADD COLUMN email');
		expect(statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS subscribers');
		expect(statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS ngrok_tokens');
		expect(statements.join('\n')).toContain('ALTER TABLE machines ADD COLUMN tooling');
		expect(kvSet).toHaveBeenCalledWith(SCHEMA_READY_KV_KEY, SCHEMA_VERSION);
	});

	it('skips the migration when the flag matches the current version', async () => {
		const { ensureDatabase, SCHEMA_VERSION } = await load();
		kvGet.mockResolvedValue(SCHEMA_VERSION);
		await ensureDatabase();
		expect(run).not.toHaveBeenCalled();
		expect(kvSet).not.toHaveBeenCalled();
	});
});
