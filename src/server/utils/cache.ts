type Wrapped<T> = { v: T; e: number };

function store() {
	return useStorage('cache');
}

// L1: in-isolate memory
const L1_MAX = 2000;
const l1 = new Map<string, Wrapped<unknown>>();

function l1Set(id: string, w: Wrapped<unknown>) {
	l1.delete(id);
	l1.set(id, w);
	if (l1.size > L1_MAX) l1.delete(l1.keys().next().value as string);
}

export async function getCache<T>(id: string): Promise<T | null> {
	const now = Date.now();
	const mem = l1.get(id);
	if (mem) {
		if (mem.e > now) return (mem.v ?? null) as T | null;
		l1.delete(id);
	}
	try {
		const raw = await store().getItem<Wrapped<T>>(id);
		if (!raw || typeof raw !== 'object' || !('e' in raw)) return null;
		// honor the embedded expiry so ttl is exact regardless of the kv driver's own eviction
		if (raw.e < now) return null;
		l1Set(id, raw as Wrapped<unknown>);
		return raw.v ?? null;
	} catch {
		return null;
	}
}

export async function cache(id: string, value: unknown, ttlSeconds: number): Promise<void> {
	if (value === null || value === undefined) return;
	const wrapped = { v: value, e: Date.now() + ttlSeconds * 1000 };
	l1Set(id, wrapped);
	try {
		await store().setItem(id, wrapped, { ttl: ttlSeconds });
	} catch (error) {
		console.warn(`cache set failed for ${id}:`, error);
	}
}

export async function tryCache<T>(
	id: string,
	fallback: () => Promise<T>,
	ttlSeconds: number
): Promise<T> {
	const hit = await getCache<T>(id);
	if (hit !== null && hit !== undefined) return hit;
	const value = await fallback();
	await cache(id, value, ttlSeconds);
	return value;
}

export async function clearCache(id: string): Promise<void> {
	l1.delete(id);
	try {
		await store().removeItem(id);
	} catch (error) {
		console.warn(`cache clear failed for ${id}:`, error);
	}
}

export async function clearCachePrefix(prefix: string): Promise<void> {
	for (const k of l1.keys()) if (k.startsWith(prefix)) l1.delete(k);
	try {
		const keys = await store().getKeys(prefix);
		await Promise.all(keys.map((k) => store().removeItem(k)));
	} catch (error) {
		console.warn(`cache clear-prefix failed for ${prefix}:`, error);
	}
}

// base64url so keys never contain chars the fs-lite dev driver treats as path separators (: / ? & =)
function safeKey(s: string): string {
	let bin = '';
	for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// centralized CACHE keys + invalidators. the list prefix keeps its ':' so clearCachePrefix can scan
// it (fs-lite maps ':' to a dir; kv treats it as a plain prefix); the base64url suffix stays single
// segment so there are no nested-path collisions
export const userCacheKey = (id: string) => `user_${safeKey(id)}`;
export const ADAPTER_LIST_PREFIX = 'list:';
export const adapterListKey = (scope: string) => `${ADAPTER_LIST_PREFIX}${safeKey(scope)}`;
export const SETTINGS_CACHE_KEY = 'settings_all';
export const FEED_CACHE_KEY = 'feed_atom';
export const PERMISSIONS_CACHE_PREFIX = 'caps:';
export const capsCacheKey = (role: string) => `${PERMISSIONS_CACHE_PREFIX}${role}`;

// role/active/profile changed -> the session hook must re-read this user
export async function invalidateUser(id: string): Promise<void> {
	await clearCache(userCacheKey(id));
}

// the atom feed renders the same public rows the grid does
export async function invalidateFeed(): Promise<void> {
	await clearCache(FEED_CACHE_KEY);
}

// any adapter create/update/publish/delete changes what the grid + dashboard lists return
export async function invalidateAdapterLists(): Promise<void> {
	await clearCachePrefix(ADAPTER_LIST_PREFIX);
	await invalidateFeed();
}

// settings.post changes both the branding blob and the permission matrix
export async function invalidateSettings(): Promise<void> {
	await clearCache(SETTINGS_CACHE_KEY);
	await clearCachePrefix(PERMISSIONS_CACHE_PREFIX);
}
