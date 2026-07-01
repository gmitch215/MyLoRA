import { beforeEach, describe, expect, it, vi } from 'vitest';

// in-memory unstorage-like backend so the CACHE helper can run in the node env
const mem = new Map<string, any>();
const storage = {
	getItem: async (k: string) => (mem.has(k) ? mem.get(k) : null),
	setItem: async (k: string, v: any) => {
		mem.set(k, v);
	},
	removeItem: async (k: string) => {
		mem.delete(k);
	},
	getKeys: async (base?: string) => [...mem.keys()].filter((k) => !base || k.startsWith(base))
};
vi.stubGlobal('useStorage', () => storage);

import {
	ADAPTER_LIST_PREFIX,
	adapterListKey,
	cache,
	clearCache,
	clearCachePrefix,
	getCache,
	invalidateAdapterLists,
	invalidateSettings,
	invalidateUser,
	SETTINGS_CACHE_KEY,
	tryCache,
	userCacheKey
} from '../../../src/server/utils/cache';

beforeEach(() => mem.clear());

describe('cache helper', () => {
	it('round-trips a value and returns null for a miss', async () => {
		expect(await getCache('nope')).toBeNull();
		await cache('k', { a: 1 }, 60);
		expect(await getCache('k')).toEqual({ a: 1 });
	});

	it('never stores null/undefined', async () => {
		await cache('n', null, 60);
		await cache('u', undefined, 60);
		expect(await getCache('n')).toBeNull();
		expect(await getCache('u')).toBeNull();
	});

	it('honors the embedded expiry', async () => {
		await cache('exp', 'v', 60);
		// force the stored entry to have already expired
		mem.set('exp', { v: 'v', e: Date.now() - 1000 });
		expect(await getCache('exp')).toBeNull();
	});

	it('tryCache runs the fallback once on a miss, then serves from cache', async () => {
		const fallback = vi.fn().mockResolvedValue('computed');
		expect(await tryCache('t', fallback, 60)).toBe('computed');
		expect(await tryCache('t', fallback, 60)).toBe('computed');
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('clearCache and clearCachePrefix remove entries', async () => {
		await cache('one', 1, 60);
		await cache(`${ADAPTER_LIST_PREFIX}a`, 1, 60);
		await cache(`${ADAPTER_LIST_PREFIX}b`, 2, 60);
		await clearCache('one');
		expect(await getCache('one')).toBeNull();
		await clearCachePrefix(ADAPTER_LIST_PREFIX);
		expect(await getCache(`${ADAPTER_LIST_PREFIX}a`)).toBeNull();
		expect(await getCache(`${ADAPTER_LIST_PREFIX}b`)).toBeNull();
	});
});

describe('cache keys', () => {
	it('builds filesystem/kv-safe keys (no path separators in the suffix)', () => {
		const key = adapterListKey('u:abc:?sort=newest&tag=x');
		expect(key.startsWith(ADAPTER_LIST_PREFIX)).toBe(true);
		// only the prefix colon is allowed; the encoded suffix has no : / ? & =
		expect(key.slice(ADAPTER_LIST_PREFIX.length)).not.toMatch(/[:/?&=]/);
		expect(userCacheKey('deadbeef')).not.toMatch(/[:/?&=]/);
	});

	it('invalidators clear the matching entries', async () => {
		await cache(userCacheKey('u1'), { id: 'u1' }, 60);
		await cache(SETTINGS_CACHE_KEY, { name: 'x' }, 60);
		await cache(adapterListKey('anon:all'), [], 60);

		await invalidateUser('u1');
		await invalidateSettings();
		await invalidateAdapterLists();

		expect(await getCache(userCacheKey('u1'))).toBeNull();
		expect(await getCache(SETTINGS_CACHE_KEY)).toBeNull();
		expect(await getCache(adapterListKey('anon:all'))).toBeNull();
	});
});
