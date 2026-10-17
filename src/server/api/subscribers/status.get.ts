import { cloudflareEnv, mailActive } from '~/server/utils/mail';

// uncached on purpose: the answer depends on the request's bindings and an admin's latest settings
export default defineEventHandler(async (event) => {
	setResponseHeader(event, 'Cache-Control', 'no-store');
	return { enabled: await mailActive(cloudflareEnv(event)) };
});
