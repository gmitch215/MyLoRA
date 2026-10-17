import { SETTINGS_CACHE_KEY, tryCache } from '~/server/utils/cache';
import { getAllSettings, toPublicSettings } from '~/server/utils/settings';

// public-safe settings (branding/social + access/permissions/rateLimits/limits/features); no secrets.
// cached on CACHE to fold the ~6 kv reads into one hot read; busted by settings.post
export default defineEventHandler(async () => {
	return tryCache(SETTINGS_CACHE_KEY, async () => toPublicSettings(await getAllSettings()), 60);
});
