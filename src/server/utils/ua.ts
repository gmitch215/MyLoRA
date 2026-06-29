import type { H3Event } from 'h3';

export function isBotUA(ua: string): boolean {
	if (!ua) return true;
	const lower = ua.toLowerCase();
	return /(bot|crawler|spider|crawling|headlesschrome|phantomjs|preview|pingdom|fetch|wget|curl|monitor|uptime|chrome-lighthouse)/i.test(
		lower
	);
}

export function classifyDevice(ua: string): 'mobile' | 'tablet' | 'desktop' {
	if (!ua) return 'desktop';
	const lower = ua.toLowerCase();
	if (/ipad|tablet/.test(lower)) return 'tablet';
	if (/mobi|android|iphone|ipod/.test(lower)) return 'mobile';
	return 'desktop';
}

export function classifyBrowser(ua: string): string {
	if (!ua) return 'other';
	const lower = ua.toLowerCase();
	if (lower.includes('edg/')) return 'edge';
	if (lower.includes('chrome/') && !lower.includes('chromium')) return 'chrome';
	if (lower.includes('firefox/')) return 'firefox';
	if (lower.includes('safari/') && !lower.includes('chrome')) return 'safari';
	if (lower.includes('opr/') || lower.includes('opera')) return 'opera';
	return 'other';
}

async function sha256Hex(input: string, length = 12): Promise<string> {
	const enc = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', enc);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (let i = 0; i < length && i < bytes.length; i++) {
		hex += bytes[i]?.toString(16).padStart(2, '0') || '';
	}
	return hex;
}

export async function visitorId(
	ip: string,
	ua: string,
	salt: string,
	day: string
): Promise<string> {
	return sha256Hex(`${salt}:${day}:${ip || 'noip'}:${ua || 'noua'}`);
}

// stable per-ip hash for rate limiting (no day component so a window survives across days)
export async function ipHash(ip: string, salt: string): Promise<string> {
	return sha256Hex(`${salt}:ip:${ip || 'noip'}`);
}

// bounded hash for use in kv keys (kv keys are length-capped)
export async function hashKey(input: string): Promise<string> {
	return sha256Hex(input, 16);
}

export function clientIp(event: H3Event): string {
	const ip =
		getRequestHeader(event, 'cf-connecting-ip') ||
		getRequestHeader(event, 'x-real-ip') ||
		getRequestHeader(event, 'x-forwarded-for') ||
		'';
	return String(ip).split(',')[0]?.trim() || '';
}
