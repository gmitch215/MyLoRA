import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildIconifyUrl,
	isIconifyId,
	proxyExternalAsset
} from '../../../src/server/utils/favicon-proxy';

describe('isIconifyId', () => {
	it('accepts prefix:name ids', () => {
		expect(isIconifyId('mdi:pencil')).toBe(true);
		expect(isIconifyId('i-lucide:box-select')).toBe(true);
		expect(isIconifyId('  simple-icons:github  ')).toBe(true);
	});

	it('rejects non-iconify strings', () => {
		expect(isIconifyId('pencil')).toBe(false);
		expect(isIconifyId('https://example.com/a.png')).toBe(false);
		expect(isIconifyId('a:')).toBe(false);
		expect(isIconifyId(':b')).toBe(false);
		expect(isIconifyId('a:b:c')).toBe(false);
	});
});

describe('buildIconifyUrl', () => {
	it('builds a default 256px svg url', () => {
		const u = buildIconifyUrl('mdi:pencil');
		expect(u).toBe('https://api.iconify.design/mdi/pencil.svg?height=256');
	});

	it('adds color and custom size', () => {
		const u = buildIconifyUrl('mdi:pencil', '#ff0000', 64);
		expect(u).toContain('https://api.iconify.design/mdi/pencil.svg?');
		expect(u).toContain('height=64');
		// url-encoded #
		expect(u).toContain('color=%23ff0000');
	});

	it('trims the id before splitting', () => {
		expect(buildIconifyUrl('  mdi:home ')).toContain('/mdi/home.svg');
	});
});

describe('proxyExternalAsset', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		delete (globalThis as any).caches;
	});

	it('returns a 200 with cache headers on a good upstream (no edge cache)', async () => {
		const bytes = new Uint8Array([1, 2, 3]).buffer;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } })
			)
		);
		const res = await proxyExternalAsset('https://x/a.png', 'image/x-icon');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('image/png');
		expect(res.headers.get('Cache-Control')).toContain('immutable');
	});

	it('falls back to fallbackType when upstream omits content-type', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array().buffer, { status: 200 }))
		);
		const res = await proxyExternalAsset('https://x/a', 'image/x-icon');
		expect(res.headers.get('Content-Type')).toBe('image/x-icon');
	});

	it('propagates a non-ok upstream status with an empty body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 404 }))
		);
		const res = await proxyExternalAsset('https://x/missing', 'image/x-icon');
		expect(res.status).toBe(404);
	});

	it('serves an edge-cache hit without fetching', async () => {
		const cached = new Response('cached', { status: 200 });
		const match = vi.fn(async () => cached);
		const put = vi.fn(async () => {});
		(globalThis as any).caches = { default: { match, put } };
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const res = await proxyExternalAsset('https://x/a.png', 'image/x-icon');
		expect(res).toBe(cached);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(match).toHaveBeenCalledOnce();
	});

	it('stores the response in the edge cache on a miss', async () => {
		const match = vi.fn(async () => undefined);
		const put = vi.fn(async () => {});
		(globalThis as any).caches = { default: { match, put } };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([9]).buffer, { status: 200 }))
		);
		const res = await proxyExternalAsset('https://x/a.png', 'image/x-icon');
		expect(res.status).toBe(200);
		expect(put).toHaveBeenCalledOnce();
	});
});
