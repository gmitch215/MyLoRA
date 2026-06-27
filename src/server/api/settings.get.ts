import { getAllSettings } from '~/server/utils/settings';

// public-safe settings (branding/social + access/permissions/rateLimits/limits/features); no secrets
export default defineEventHandler(async () => {
	return await getAllSettings();
});
