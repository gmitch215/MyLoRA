import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clampPublicLimit,
	DEFAULT_ACCESS,
	DEFAULT_FEATURES,
	DEFAULT_LIMITS,
	DEFAULT_PERMISSIONS,
	DEFAULT_RATE_LIMITS,
	PUBLIC_LIMIT_RANGES
} from '../../../src/shared/defaults';
import { CF_MAX_RANK, CF_MAX_WEIGHTS_BYTES } from '../../../src/shared/schemas';

// settings.ts relies on nuxt auto-imports (kv global + the DEFAULT_* / clamp helpers); in plain node
// none exist, so wire the real values in as globals before importing the module
const store = new Map<string, unknown>();
let getImpl: (k: string) => unknown = (k) => store.get(k) ?? null;
const kv = {
	get: vi.fn(async (k: string) => getImpl(k)),
	set: vi.fn(async (k: string, v: unknown) => void store.set(k, v))
};
vi.stubGlobal('kv', kv);
vi.stubGlobal('DEFAULT_ACCESS', DEFAULT_ACCESS);
vi.stubGlobal('DEFAULT_FEATURES', DEFAULT_FEATURES);
vi.stubGlobal('DEFAULT_LIMITS', DEFAULT_LIMITS);
vi.stubGlobal('DEFAULT_PERMISSIONS', DEFAULT_PERMISSIONS);
vi.stubGlobal('DEFAULT_RATE_LIMITS', DEFAULT_RATE_LIMITS);
vi.stubGlobal('PUBLIC_LIMIT_RANGES', PUBLIC_LIMIT_RANGES);
vi.stubGlobal('clampPublicLimit', clampPublicLimit);
vi.stubGlobal('CF_MAX_RANK', CF_MAX_RANK);
vi.stubGlobal('CF_MAX_WEIGHTS_BYTES', CF_MAX_WEIGHTS_BYTES);

let mod: typeof import('../../../src/server/utils/settings');

beforeAll(async () => {
	mod = await import('../../../src/server/utils/settings');
});

beforeEach(() => {
	store.clear();
	getImpl = (k) => store.get(k) ?? null;
	kv.get.mockClear();
	kv.set.mockClear();
});

const K = (n: string) => `mylora:setting:${n}`;

describe('getAccess / getFeatures fall back to defaults', () => {
	it('returns defaults when unset', async () => {
		expect(await mod.getAccess()).toEqual(DEFAULT_ACCESS);
		expect(await mod.getFeatures()).toEqual(DEFAULT_FEATURES);
	});

	it('returns the stored value when present', async () => {
		const custom = { ...DEFAULT_ACCESS, downloadAccess: 'private' };
		store.set(K('access'), custom);
		expect(await mod.getAccess()).toEqual(custom);
	});

	it('falls back when kv throws', async () => {
		getImpl = () => {
			throw new Error('kv down');
		};
		expect(await mod.getAccess()).toEqual(DEFAULT_ACCESS);
	});
});

describe('getPermissions merges partial overrides onto defaults', () => {
	it('deep-merges each tier', async () => {
		store.set(K('permissions'), { developer: { canPublish: true }, manager: {} });
		const p = await mod.getPermissions();
		expect(p.developer.canPublish).toBe(true);
		// untouched developer keys keep their default
		expect(p.developer.canCreate).toBe(DEFAULT_PERMISSIONS.developer.canCreate);
		expect(p.manager).toEqual(DEFAULT_PERMISSIONS.manager);
	});
});

describe('getRateLimits clamps the public tier', () => {
	it('clamps values above the max down and below the min up', async () => {
		store.set(K('rateLimits'), {
			public: { promptsPerHour: 999, outputTokensPerHour: 0, precedence: 'prompts' },
			developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
		});
		const rl = await mod.getRateLimits();
		expect(rl.public.promptsPerHour).toBe(PUBLIC_LIMIT_RANGES.promptsPerHour.max);
		expect(rl.public.outputTokensPerHour).toBe(PUBLIC_LIMIT_RANGES.outputTokensPerHour.min);
		expect(rl.public.precedence).toBe('prompts');
	});

	it('leaves an in-range public value untouched and never clamps developer', async () => {
		store.set(K('rateLimits'), {
			public: { promptsPerHour: 5, outputTokensPerHour: 5000, precedence: 'tokens' },
			developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
		});
		const rl = await mod.getRateLimits();
		expect(rl.public.promptsPerHour).toBe(5);
		expect(rl.public.outputTokensPerHour).toBe(5000);
		expect(rl.developer.promptsPerHour).toBe(0);
	});
});

describe('getLimits caps to cloudflare maxima', () => {
	it('caps weights + rank at the CF ceiling', async () => {
		store.set(K('limits'), {
			...DEFAULT_LIMITS,
			maxWeightsBytes: CF_MAX_WEIGHTS_BYTES * 10,
			maxRank: CF_MAX_RANK + 100
		});
		const l = await mod.getLimits();
		expect(l.maxWeightsBytes).toBe(CF_MAX_WEIGHTS_BYTES);
		expect(l.maxRank).toBe(CF_MAX_RANK);
	});

	it('leaves smaller configured values intact', async () => {
		store.set(K('limits'), { ...DEFAULT_LIMITS, maxWeightsBytes: 1024, maxRank: 4 });
		const l = await mod.getLimits();
		expect(l.maxWeightsBytes).toBe(1024);
		expect(l.maxRank).toBe(4);
	});
});

describe('string settings', () => {
	it('getStringSetting returns null when unset and on error', async () => {
		expect(await mod.getStringSetting('name')).toBeNull();
		getImpl = () => {
			throw new Error('boom');
		};
		expect(await mod.getStringSetting('name')).toBeNull();
	});

	it('setStringSetting writes under the prefixed key', async () => {
		await mod.setStringSetting('name', 'My Registry');
		expect(store.get(K('name'))).toBe('My Registry');
		expect(await mod.getStringSetting('name')).toBe('My Registry');
	});

	it('setJsonSetting writes structured values', async () => {
		await mod.setJsonSetting('features', { x: 1 });
		expect(store.get(K('features'))).toEqual({ x: 1 });
	});
});

describe('getAllSettings', () => {
	it('assembles strings + structured sections, omitting unset strings', async () => {
		store.set(K('name'), 'Reg');
		const all = await mod.getAllSettings();
		expect(all.name).toBe('Reg');
		expect(all.description).toBeUndefined();
		expect(all.access).toEqual(DEFAULT_ACCESS);
		expect(all.features).toEqual(DEFAULT_FEATURES);
		expect(all.message).toBeNull();
		expect(all.limits.maxRank).toBe(CF_MAX_RANK);
	});
});
