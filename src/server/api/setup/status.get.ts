import { kv } from 'hub:kv';
import {
	describeDbError,
	ensureDatabase,
	SETUP_COMPLETED_KV_KEY,
	userCount
} from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	const cfg = useRuntimeConfig();
	const hasLegacyPassword = Boolean(cfg.password) && cfg.password !== 'password';
	try {
		await ensureDatabase();
		const count = await userCount();
		let flagged = false;
		try {
			flagged = Boolean(await kv.get<string>(SETUP_COMPLETED_KV_KEY));
		} catch (kvError) {
			console.warn('setup flag read failed:', describeDbError(kvError));
		}
		// this browser already finished setup; survives d1/kv read lag right after the insert
		const sealed = Boolean(getCookie(event, SETUP_COOKIE));
		// needs setup only when every signal agrees it is undone: no users, no kv flag, no cookie
		const needsSetup = count === 0 && !flagged && !sealed;
		return { needsSetup, hasLegacyPassword, userCount: count };
	} catch (error) {
		console.error('setup status failed:', describeDbError(error));
		throw createError({
			statusCode: 503,
			statusMessage: `Setup status unavailable: ${describeDbError(error)}`
		});
	}
});
