import { describe, expect, it } from 'vitest';
import cloudflare from '../../../node_modules/@nuxt/image/dist/runtime/providers/cloudflare.js';

// the card/viewer presets in nuxt.config.ts pass these modifiers to the cloudflare provider when
// MYLORA_IMAGE_RESIZING=1 is set at build time; this pins how that provider renders them
const getImage = (cloudflare as any)().getImage as (
	src: string,
	ctx: { modifiers: Record<string, unknown>; baseURL?: string }
) => { url: string };

describe('cloudflare image provider with the screenshot presets', () => {
	const modifiers = { width: 480, format: 'auto', quality: 80, fit: 'cover', onerror: 'redirect' };

	it('builds a cdn-cgi url that falls back to the original on error', () => {
		const { url } = getImage('/files/adapters/a1/screenshots/Shot%2012.png', { modifiers });
		expect(url.startsWith('/cdn-cgi/image/')).toBe(true);
		for (const part of ['w=480', 'f=auto', 'q=80', 'fit=cover', 'onerror=redirect']) {
			expect(url).toContain(part);
		}
	});

	it('keeps the encoded source path as the last segment', () => {
		const { url } = getImage('/files/adapters/a1/screenshots/Shot%2012.png', { modifiers });
		expect(url.endsWith('/files/adapters/a1/screenshots/Shot%2012.png')).toBe(true);
	});
});
