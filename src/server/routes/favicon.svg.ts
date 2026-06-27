import { kv } from 'hub:kv';
import { buildIconifyUrl, isIconifyId, proxyExternalAsset } from '~/server/utils/favicon-proxy';

export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig();
	const favicon =
		(await kv.get<string>('mylora:setting:favicon')) ||
		(await kv.get<string>('mylora:setting:faviconPng'));

	// the svg route serves iconify icons (tinted with the theme color); uploads/urls use ico/png
	if (favicon && isIconifyId(favicon)) {
		const color =
			(await kv.get<string>('mylora:setting:themeColor')) || config.public.themeColor || '';
		return proxyExternalAsset(buildIconifyUrl(favicon, color), 'image/svg+xml');
	}

	throw createError({ statusCode: 404, statusMessage: 'No SVG favicon configured' });
});
