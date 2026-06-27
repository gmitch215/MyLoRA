// edge-cached proxy for externally-hosted favicons
const PROXY_CACHE_TTL = 60 * 60 * 24 * 7;
const PROXY_FETCH_TIMEOUT_MS = 5000;

// an iconify icon id looks like "prefix:name" (e.g. mdi:pencil)
const ICONIFY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export function isIconifyId(value: string): boolean {
	return ICONIFY_RE.test(value.trim());
}

// build the iconify api svg url for an icon id, optionally tinted with the theme color
export function buildIconifyUrl(iconId: string, color?: string, size = 256): string {
	const [prefix, name] = iconId.trim().split(':');
	const params = new URLSearchParams({ height: String(size) });
	if (color) params.set('color', color);
	return `https://api.iconify.design/${prefix}/${name}.svg?${params.toString()}`;
}

export async function proxyExternalAsset(url: string, fallbackType: string): Promise<Response> {
	const cacheKey = new Request(url, { method: 'GET' });
	const edgeCache = (globalThis as any).caches?.default as Cache | undefined;

	if (edgeCache) {
		const hit = await edgeCache.match(cacheKey).catch(() => undefined);
		if (hit) return hit;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROXY_FETCH_TIMEOUT_MS);
	let upstream: Response;
	try {
		upstream = await fetch(url, { signal: controller.signal, redirect: 'follow' });
	} finally {
		clearTimeout(timer);
	}

	if (!upstream.ok) return new Response(null, { status: upstream.status });

	const headers = new Headers();
	headers.set('Content-Type', upstream.headers.get('Content-Type') ?? fallbackType);
	headers.set('Cache-Control', `public, max-age=${PROXY_CACHE_TTL}, immutable`);
	const body = await upstream.arrayBuffer();
	const response = new Response(body, { status: 200, headers });

	if (edgeCache) {
		try {
			await edgeCache.put(cacheKey, response.clone());
		} catch (error) {
			console.warn('favicon cache put failed:', error);
		}
	}

	return response;
}
