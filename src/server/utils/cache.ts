type Wrapped<T> = { v: T; e: number };

function store() {
	return useStorage('cache');
}

export async function getCache<T>(id: string): Promise<T | null> {
	try {
		const raw = await store().getItem<Wrapped<T>>(id);
		if (!raw || typeof raw !== 'object' || !('e' in raw)) return null;
		// honor the embedded expiry so ttl is exact regardless of the kv driver's own eviction
		if (raw.e < Date.now()) return null;
		return raw.v ?? null;
	} catch {
		return null;
	}
}

export async function cache(id: string, value: unknown, ttlSeconds: number): Promise<void> {
	if (value === null || value === undefined) return;
	try {
		await store().setItem(id, { v: value, e: Date.now() + ttlSeconds * 1000 }, { ttl: ttlSeconds });
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
	try {
		await store().removeItem(id);
	} catch (error) {
		console.warn(`cache clear failed for ${id}:`, error);
	}
}

export async function clearCachePrefix(prefix: string): Promise<void> {
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

// role/active/profile changed -> the session hook must re-read this user
export async function invalidateUser(id: string): Promise<void> {
	await clearCache(userCacheKey(id));
}

// any adapter create/update/publish/delete changes what the grid + dashboard lists return
export async function invalidateAdapterLists(): Promise<void> {
	await clearCachePrefix(ADAPTER_LIST_PREFIX);
}

export async function invalidateSettings(): Promise<void> {
	await clearCache(SETTINGS_CACHE_KEY);
}
