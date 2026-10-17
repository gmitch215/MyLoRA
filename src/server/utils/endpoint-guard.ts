import { isMockCf } from './cloudflare';

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [
	'.localhost',
	'.local',
	'.internal',
	'.lan',
	'.home.arpa',
	'.intranet',
	'.corp',
	'.workers.dev'
];

// ports a public https service has no business on: the well-known ones except 443
function portAllowed(port: number): boolean {
	return port === 443 || (port >= 1024 && port <= 65535);
}

/**
 * Checks a user-supplied endpoint url without touching the network: https only, a real public
 * hostname (no ip literals, no single-label or internal names), no credentials in the url, and no
 * query or fragment. `siteHost` rejects the app's own host so the tester cannot call itself.
 */
export function parseEndpointUrl(raw: string, siteHost?: string | null): UrlCheck {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, reason: 'Enter a full https URL, such as https://vllm.example.com/v1' };
	}
	if (url.protocol !== 'https:') return { ok: false, reason: 'The URL must use https' };
	if (url.username || url.password) {
		return { ok: false, reason: 'Put the key in the key field, not in the URL' };
	}
	if (url.search || url.hash)
		return { ok: false, reason: 'The URL cannot have a query or fragment' };

	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	if (!host) return { ok: false, reason: 'The URL needs a hostname' };
	if (host.startsWith('[') || /^[\d.]+$/.test(host) || host.includes(':')) {
		return { ok: false, reason: 'Use a hostname, not an IP address' };
	}
	if (!host.includes('.')) {
		return { ok: false, reason: 'The hostname must be a public domain name' };
	}
	if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
		return { ok: false, reason: 'That hostname is internal or not allowed' };
	}
	if (siteHost && host === siteHost.toLowerCase()) {
		return { ok: false, reason: 'The endpoint cannot be this site itself' };
	}
	const port = url.port ? Number(url.port) : 443;
	if (!portAllowed(port)) return { ok: false, reason: 'That port is not allowed' };

	url.pathname = url.pathname.replace(/\/+$/, '');
	return { ok: true, url };
}

/** The url as stored: normalized, no trailing slash. */
export function endpointBase(url: URL): string {
	return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

// #region ip ranges

function v4Private(parts: number[]): boolean {
	const [a, b] = parts as [number, number];
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 192 && b === 0) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	return a >= 224;
}

/** True for loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
	const value = ip.trim().toLowerCase();
	const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) return v4Private(v4.slice(1).map(Number));
	if (!value.includes(':')) return true;
	if (value === '::' || value === '::1') return true;
	const mapped = value.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (mapped) return v4Private(mapped.slice(1).map(Number));
	if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(value)) return true;
	const first = parseInt(value.split(':')[0] || '0', 16);
	if ((first & 0xfe00) === 0xfc00) return true;
	if ((first & 0xffc0) === 0xfe80) return true;
	return (first & 0xff00) === 0xff00;
}

// #endregion

const RESOLVED = new Map<string, { until: number; ok: boolean; reason: string }>();
const RESOLVE_TTL_MS = 60_000;

type DohAnswer = { type: number; data: string };

async function dohAddresses(host: string, type: 'A' | 'AAAA'): Promise<string[]> {
	const res = await fetch(
		`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
		{ headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) }
	);
	if (!res.ok) throw new Error(`dns lookup failed (${res.status})`);
	const json = (await res.json()) as { Answer?: DohAnswer[] };
	// type 1 = A, 28 = AAAA; CNAME answers are followed by the resolver
	const want = type === 'A' ? 1 : 28;
	return (json.Answer ?? []).filter((a) => a.type === want).map((a) => a.data);
}

/**
 * Resolves the hostname over DoH and rejects it when any address is non-public. A hostname can
 * be repointed after it was saved, so this runs on every call, with a 60s per-isolate cache.
 */
export async function assertPublicHost(host: string): Promise<void> {
	// the mock lane never reaches the network
	if (isMockCf()) return;
	const key = host.toLowerCase();
	const hit = RESOLVED.get(key);
	if (hit && hit.until > Date.now()) {
		if (!hit.ok) throw new Error(hit.reason);
		return;
	}
	let reason = '';
	try {
		const [a, aaaa] = await Promise.all([dohAddresses(key, 'A'), dohAddresses(key, 'AAAA')]);
		const all = [...a, ...aaaa];
		if (all.length === 0) reason = 'The hostname does not resolve';
		else if (all.some(isPrivateIp)) reason = 'The hostname resolves to a non-public address';
	} catch (error) {
		// fail closed: an address that cannot be checked is not called
		reason = `The hostname could not be checked: ${(error as Error).message}`;
	}
	RESOLVED.set(key, { until: Date.now() + RESOLVE_TTL_MS, ok: !reason, reason });
	if (reason) throw new Error(reason);
}

export function clearResolveCache(): void {
	RESOLVED.clear();
}
