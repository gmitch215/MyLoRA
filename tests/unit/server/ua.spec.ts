import { describe, expect, it } from 'vitest';
import {
	classifyBrowser,
	classifyDevice,
	hashKey,
	ipHash,
	isBotUA,
	visitorId
} from '../../../src/server/utils/ua';

// real-ish agents to exercise each branch
const CHROME =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const SAFARI =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
const EDGE = `${CHROME} Edg/120.0`;
const OPERA = 'Opera/9.80 (Windows NT 6.0; U; en) Presto/2.12 Version/12.14';
const IPHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const IPAD =
	'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const ANDROID =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

describe('isBotUA', () => {
	it('treats empty as a bot', () => {
		expect(isBotUA('')).toBe(true);
	});

	it('flags known bot/monitor tokens', () => {
		for (const ua of [
			'Googlebot/2.1',
			'Some Crawler',
			'python spider',
			'HeadlessChrome/120',
			'curl/8.0',
			'Wget/1.21',
			'Pingdom.com_bot',
			'Chrome-Lighthouse',
			'UptimeRobot'
		]) {
			expect(isBotUA(ua)).toBe(true);
		}
	});

	it('passes a real browser', () => {
		expect(isBotUA(CHROME)).toBe(false);
	});
});

describe('classifyDevice', () => {
	it('defaults to desktop on empty', () => {
		expect(classifyDevice('')).toBe('desktop');
	});

	it('detects tablet before mobile', () => {
		expect(classifyDevice(IPAD)).toBe('tablet');
		expect(classifyDevice('some tablet device')).toBe('tablet');
	});

	it('detects mobile', () => {
		expect(classifyDevice(IPHONE)).toBe('mobile');
		expect(classifyDevice(ANDROID)).toBe('mobile');
	});

	it('falls back to desktop', () => {
		expect(classifyDevice(CHROME)).toBe('desktop');
	});
});

describe('classifyBrowser', () => {
	it('returns other on empty', () => {
		expect(classifyBrowser('')).toBe('other');
	});

	it('detects edge before chrome', () => {
		expect(classifyBrowser(EDGE)).toBe('edge');
	});

	it('detects chrome', () => {
		expect(classifyBrowser(CHROME)).toBe('chrome');
	});

	it('detects firefox', () => {
		expect(classifyBrowser(FIREFOX)).toBe('firefox');
	});

	it('detects safari', () => {
		expect(classifyBrowser(SAFARI)).toBe('safari');
	});

	it('detects opera (legacy UA without a chrome/ token)', () => {
		expect(classifyBrowser(OPERA)).toBe('opera');
		expect(classifyBrowser('Opera/9.80 (Windows NT 6.0)')).toBe('opera');
	});

	it('a modern chromium-based opera reports chrome (chrome/ wins first)', () => {
		// classifyBrowser checks chrome/ before opr/, so a chromium opera is bucketed as chrome
		expect(classifyBrowser(`${CHROME} OPR/106.0`)).toBe('chrome');
	});

	it('returns other for unknown', () => {
		expect(classifyBrowser('lynx')).toBe('other');
	});
});

describe('hashing helpers', () => {
	it('visitorId is deterministic and 24 hex chars', async () => {
		const a = await visitorId('1.2.3.4', CHROME, 'salt', '2026-07-01');
		const b = await visitorId('1.2.3.4', CHROME, 'salt', '2026-07-01');
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{24}$/);
	});

	it('visitorId changes with day/salt/ip', async () => {
		const base = await visitorId('1.2.3.4', CHROME, 'salt', '2026-07-01');
		expect(await visitorId('1.2.3.4', CHROME, 'salt', '2026-07-02')).not.toBe(base);
		expect(await visitorId('1.2.3.4', CHROME, 'other', '2026-07-01')).not.toBe(base);
		expect(await visitorId('9.9.9.9', CHROME, 'salt', '2026-07-01')).not.toBe(base);
	});

	it('visitorId tolerates empty ip/ua (noip/noua fallbacks)', async () => {
		const a = await visitorId('', '', 'salt', 'd');
		expect(a).toMatch(/^[0-9a-f]{24}$/);
	});

	it('ipHash is stable across days (no day component)', async () => {
		const a = await ipHash('1.2.3.4', 'salt');
		const b = await ipHash('1.2.3.4', 'salt');
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{24}$/);
		expect(await ipHash('', 'salt')).toMatch(/^[0-9a-f]{24}$/);
	});

	it('hashKey is 32 hex chars', async () => {
		const a = await hashKey('mylora:rl:x');
		expect(a).toMatch(/^[0-9a-f]{32}$/);
		expect(await hashKey('mylora:rl:x')).toBe(a);
		expect(await hashKey('mylora:rl:y')).not.toBe(a);
	});
});
