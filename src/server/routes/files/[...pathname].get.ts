import { blob } from 'hub:blob';

export default defineEventHandler(async (event) => {
	const pathname = getRouterParam(event, 'pathname');
	if (!pathname) {
		throw createError({ statusCode: 400, statusMessage: 'Missing pathname' });
	}
	const decoded = decodeURIComponent(pathname);
	if (!/^adapters\/[^/]+\/screenshots\//.test(decoded)) {
		throw createError({ statusCode: 404, statusMessage: 'Not found' });
	}

	setHeader(event, 'Cache-Control', 'public, max-age=86400');
	return blob.serve(event, decoded);
});
