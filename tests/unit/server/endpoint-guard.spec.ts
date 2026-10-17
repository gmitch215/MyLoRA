import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));

let mod: typeof import('../../../src/server/utils/endpoint-guard');

beforeAll(async () => {
	mod = await import('../../../src/server/utils/endpoint-guard');
});

describe('parseEndpointUrl', () => {
	const ok = (raw: string, siteHost?: string) => {
		const r = mod.parseEndpointUrl(raw, siteHost);
		expect(r.ok, raw).toBe(true);
		return r.ok ? mod.endpointBase(r.url) : '';
	};
	const bad = (raw: string, siteHost?: string) => {
		const r = mod.parseEndpointUrl(raw, siteHost);
		expect(r.ok, raw).toBe(false);
		return r.ok ? '' : r.reason;
	};

	it('accepts a public https hostname and strips trailing slashes', () => {
		expect(ok('https://vllm.example.com/v1/')).toBe('https://vllm.example.com/v1');
		expect(ok('https://abc-123.ngrok-free.app')).toBe('https://abc-123.ngrok-free.app');
		expect(ok('https://x.trycloudflare.com:8443/v1')).toBe('https://x.trycloudflare.com:8443/v1');
	});

	it('rejects anything but https', () => {
		expect(bad('http://vllm.example.com/v1')).toMatch(/https/);
		expect(bad('ftp://vllm.example.com')).toMatch(/https/);
		expect(bad('not a url')).toMatch(/full https URL/);
	});

	it('rejects ip literals in every encoding the url parser normalizes', () => {
		for (const host of [
			'127.0.0.1',
			'10.0.0.5',
			'169.254.169.254',
			'192.168.1.10',
			'8.8.8.8',
			'2130706433',
			'0x7f000001',
			'0177.0.0.1',
			'[::1]',
			'[fd00::1]',
			'[::ffff:127.0.0.1]'
		]) {
			expect(bad(`https://${host}/v1`), host).toMatch(/hostname|IP/i);
		}
	});

	it('rejects internal and single-label names', () => {
		for (const host of [
			'localhost',
			'app.localhost',
			'printer.local',
			'db.internal',
			'nas.lan',
			'router.home.arpa',
			'intranet',
			'x.workers.dev'
		]) {
			expect(bad(`https://${host}/v1`), host).not.toBe('');
		}
	});

	it('rejects credentials, queries, fragments and well-known ports', () => {
		expect(bad('https://user:pw@vllm.example.com/v1')).toMatch(/key field/);
		expect(bad('https://vllm.example.com/v1?key=1')).toMatch(/query/);
		expect(bad('https://vllm.example.com/v1#x')).toMatch(/query or fragment/);
		expect(bad('https://vllm.example.com:22/v1')).toMatch(/port/);
		expect(bad('https://vllm.example.com:80/v1')).toMatch(/port/);
		expect(ok('https://vllm.example.com:8000/v1')).toBe('https://vllm.example.com:8000/v1');
		expect(ok('https://vllm.example.com:443/v1')).toBe('https://vllm.example.com/v1');
	});

	it('rejects the site itself', () => {
		expect(bad('https://mylora.example.com/v1', 'mylora.example.com')).toMatch(/this site/);
		expect(ok('https://other.example.com/v1', 'mylora.example.com')).toBe(
			'https://other.example.com/v1'
		);
	});
});

describe('isPrivateIp', () => {
	it.each([
		['0.0.0.0', true],
		['10.1.2.3', true],
		['100.64.0.1', true],
		['100.128.0.1', false],
		['127.0.0.1', true],
		['169.254.169.254', true],
		['172.15.0.1', false],
		['172.16.0.1', true],
		['172.31.255.255', true],
		['172.32.0.1', false],
		['192.168.0.1', true],
		['192.0.0.1', true],
		['198.18.0.1', true],
		['224.0.0.1', true],
		['255.255.255.255', true],
		['1.1.1.1', false],
		['93.184.216.34', false],
		['::', true],
		['::1', true],
		['fc00::1', true],
		['fd12:3456::1', true],
		['fe80::1', true],
		['ff02::1', true],
		['::ffff:10.0.0.1', true],
		['::ffff:8.8.8.8', false],
		['2606:4700:4700::1111', false],
		['not an ip', true]
	])('%s -> private %s', (ip, expected) => {
		expect(mod.isPrivateIp(ip)).toBe(expected);
	});
});

describe('assertPublicHost', () => {
	const answers = (data: string[], type = 1) => ({
		ok: true,
		json: async () => ({ Answer: data.map((d) => ({ type, data: d })) })
	});

	beforeEach(() => mod.clearResolveCache());
	afterEach(() => vi.unstubAllGlobals());

	function stubDns(a: string[], aaaa: string[] = []) {
		vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => (url.includes('type=AAAA') ? answers(aaaa, 28) : answers(a, 1)))
		);
	}

	it('passes a hostname that resolves to public addresses', async () => {
		stubDns(['93.184.216.34'], ['2606:4700::1']);
		await expect(mod.assertPublicHost('vllm.example.com')).resolves.toBeUndefined();
	});

	it('rejects a hostname that resolves to a private address, even alongside a public one', async () => {
		stubDns(['93.184.216.34', '10.0.0.8']);
		await expect(mod.assertPublicHost('rebind.example.com')).rejects.toThrow(/non-public/);
	});

	it('rejects a hostname that does not resolve', async () => {
		stubDns([]);
		await expect(mod.assertPublicHost('nothing.example.com')).rejects.toThrow(/does not resolve/);
	});

	it('fails closed when the lookup itself fails', async () => {
		vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		await expect(mod.assertPublicHost('down.example.com')).rejects.toThrow(/could not be checked/);
	});

	it('caches a verdict for the isolate so repeat calls cost no lookup', async () => {
		stubDns(['93.184.216.34']);
		await mod.assertPublicHost('cached.example.com');
		await mod.assertPublicHost('cached.example.com');
		expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
	});
});
