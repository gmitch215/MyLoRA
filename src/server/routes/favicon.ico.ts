import { kv } from 'hub:kv';
import { isIconifyId, proxyExternalAsset } from '~/server/utils/favicon-proxy';

export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig();
	const favicon = await kv.get<string>('mylora:setting:favicon');

	// iconify icon ids are served by /favicon.svg; 404 here so the browser uses the svg link
	if (favicon && isIconifyId(favicon)) {
		throw createError({ statusCode: 404, statusMessage: 'Icon ids are served by /favicon.svg' });
	}

	if (favicon && favicon.startsWith('data:')) {
		const matches = favicon.match(/^data:([^;]+);base64,(.+)$/);
		if (matches) {
			const mimeType = matches[1]!;
			const binary = atob(matches[2]!);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			setHeader(event, 'Content-Type', mimeType);
			setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
			return bytes;
		}
	}
	if (favicon && (favicon.startsWith('http://') || favicon.startsWith('https://'))) {
		return proxyExternalAsset(favicon, 'image/x-icon');
	}
	if (favicon && favicon.startsWith('/') && favicon !== '/favicon.ico') {
		return sendRedirect(event, favicon, 301);
	}
	return sendRedirect(event, config.public.favicon, 301);
});
