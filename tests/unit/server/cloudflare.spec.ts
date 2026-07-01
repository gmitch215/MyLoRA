import { beforeAll, describe, expect, it, vi } from 'vitest';

// canonicalizeAdapterConfig throws via the auto-imported createError; give it a real Error shape
vi.stubGlobal('createError', (o: { statusCode?: number; statusMessage?: string }) => {
	const e = new Error(o.statusMessage) as Error & { statusCode?: number };
	e.statusCode = o.statusCode;
	return e;
});
// isMockCf reads useRuntimeConfig().mockCf
vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));

let mod: typeof import('../../../src/server/utils/cloudflare');

beforeAll(async () => {
	mod = await import('../../../src/server/utils/cloudflare');
});

describe('describeCfError', () => {
	it('surfaces every cf error with codes joined', () => {
		const err = {
			errors: [
				{ message: 'bad token', code: 1000 },
				{ message: 'no access', code: 2000 }
			]
		};
		expect(mod.describeCfError(err)).toBe('bad token [1000]; no access [2000]');
	});

	it('omits the code bracket when absent', () => {
		expect(mod.describeCfError({ errors: [{ message: 'oops' }] })).toBe('oops');
	});

	it('falls back to message then walks the cause chain', () => {
		expect(mod.describeCfError({ message: 'top' })).toBe('top');
		const nested = { cause: { cause: { message: 'deep' } } };
		expect(mod.describeCfError(nested)).toBe('deep');
	});

	it('stringifies a bare value', () => {
		expect(mod.describeCfError('plain')).toBe('plain');
		expect(mod.describeCfError(42)).toBe('42');
	});

	it('does not loop on a cyclic cause', () => {
		const a: any = { message: '' };
		a.cause = a;
		expect(() => mod.describeCfError(a)).not.toThrow();
	});
});

describe('explainCfError', () => {
	it('adds token-permission guidance for an auth rejection', () => {
		const out = mod.explainCfError({ message: 'ACTION_NOT_AUTHORIZED' });
		expect(out).toContain('not authorized');
		expect(out).toContain('Workers AI: Edit');
	});

	it('appends the request context when url/method are attached', () => {
		const err: any = { message: 'permission denied', url: 'https://api/x', method: 'POST' };
		const out = mod.explainCfError(err);
		expect(out).toContain('Request: POST https://api/x');
	});

	it('returns the raw message unchanged for a non-auth error', () => {
		expect(mod.explainCfError({ message: 'rate limited' })).toBe('rate limited');
	});
});

describe('cfErrorStatus', () => {
	it('returns a numeric status or undefined', () => {
		expect(mod.cfErrorStatus({ status: 503 })).toBe(503);
		expect(mod.cfErrorStatus({ status: 'x' })).toBeUndefined();
		expect(mod.cfErrorStatus({})).toBeUndefined();
	});
});

describe('isBenignCfError', () => {
	it('treats a 409 as benign', () => {
		expect(mod.isBenignCfError({ status: 409 })).toBe(true);
	});

	it('matches dedupe/duplicate/conflict messages', () => {
		expect(mod.isBenignCfError({ message: 'adapter already exists' })).toBe(true);
		expect(mod.isBenignCfError({ message: 'duplicate config' })).toBe(true);
		expect(mod.isBenignCfError({ message: 'same file uploaded' })).toBe(true);
	});

	it('is false for an unrelated error', () => {
		expect(mod.isBenignCfError({ message: 'bad request' })).toBe(false);
	});
});

describe('isTransientCfError', () => {
	it('treats 5xx as transient', () => {
		expect(mod.isTransientCfError({ status: 500 })).toBe(true);
		expect(mod.isTransientCfError({ status: 502 })).toBe(true);
	});

	it('matches network/timeout/internal-error transport phrases', () => {
		for (const m of [
			'internal error; reference = abc',
			'network connection lost',
			'connection reset by peer',
			'request timed out',
			'fetch failed',
			'socket hang up'
		]) {
			expect(mod.isTransientCfError({ message: m })).toBe(true);
		}
	});

	it('is false for a plain 4xx client error', () => {
		expect(mod.isTransientCfError({ status: 400, message: 'bad input' })).toBe(false);
	});
});

describe('canonicalizeAdapterConfig', () => {
	it('overwrites model_type and pretty-prints', () => {
		const { json } = mod.canonicalizeAdapterConfig('{"r":8,"model_type":"wrong"}', 'llama' as any);
		const parsed = JSON.parse(json);
		expect(parsed.model_type).toBe('llama');
		expect(parsed.r).toBe(8);
		expect(json).toContain('\n');
	});

	it('throws a 400 on invalid json', () => {
		try {
			mod.canonicalizeAdapterConfig('not json', 'llama' as any);
			throw new Error('should have thrown');
		} catch (e: any) {
			expect(e.statusCode).toBe(400);
		}
	});
});

describe('readRankFromConfig', () => {
	it('reads r / lora_rank / rank in order', () => {
		expect(mod.readRankFromConfig('{"r":16}')).toBe(16);
		expect(mod.readRankFromConfig('{"lora_rank":8}')).toBe(8);
		expect(mod.readRankFromConfig('{"rank":4}')).toBe(4);
	});

	it('returns null for missing/non-numeric/invalid', () => {
		expect(mod.readRankFromConfig('{}')).toBeNull();
		expect(mod.readRankFromConfig('{"r":"x"}')).toBeNull();
		expect(mod.readRankFromConfig('nope')).toBeNull();
	});
});

describe('isMockCf', () => {
	it('is false when mockCf is off', () => {
		expect(mod.isMockCf()).toBe(false);
	});
});

describe('CfUnsupported', () => {
	it('carries the op in its message + name', () => {
		const e = new mod.CfUnsupported('DELETE finetune');
		expect(e).toBeInstanceOf(Error);
		expect(e.name).toBe('CfUnsupported');
		expect(e.message).toContain('DELETE finetune');
	});
});
