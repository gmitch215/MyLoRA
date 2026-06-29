import { kv } from 'hub:kv';
import { buildIconifyUrl, isIconifyId, proxyExternalAsset } from '~/server/utils/favicon-proxy';

// resolve the configured favicon; never 404/500 - always fall back to the bundled static icon
export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig();
	const fallback =
		config.public.favicon && config.public.favicon !== '/favicon.ico'
			? config.public.favicon
			: '/_favicon.ico';
	try {
		const favicon = await kv.get<string>('mylora:setting:favicon');

		if (favicon && isIconifyId(favicon)) {
			// serve the icon directly (modern browsers accept svg at /favicon.ico) instead of 404ing
			const color =
				(await kv.get<string>('mylora:setting:themeColor')) || config.public.themeColor || '';
			const res = await proxyExternalAsset(buildIconifyUrl(favicon, color), 'image/svg+xml');
			if (res.ok) return res;
		} else if (favicon && favicon.startsWith('data:')) {
			const matches = favicon.match(/^data:([^;]+);base64,(.+)$/);
			if (matches) {
				const binary = atob(matches[2]!);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
				setHeader(event, 'Content-Type', matches[1]!);
				setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
				return bytes;
			}
		} else if (favicon && /^https?:\/\//.test(favicon)) {
			const res = await proxyExternalAsset(favicon, 'image/x-icon');
			if (res.ok) return res;
		} else if (favicon && favicon.startsWith('/') && favicon !== '/favicon.ico') {
			return sendRedirect(event, favicon, 302);
		}
	} catch (error) {
		console.warn('favicon.ico resolution failed, using fallback:', error);
	}
	return sendRedirect(event, fallback, 302);
});
