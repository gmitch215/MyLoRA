import { getCurrentUser } from '~/server/utils/auth';
import { isNonProdRuntime } from '~/server/utils/env';
import { enforceLimit, rateSubject } from '~/server/utils/ratelimit';

// per-class ceilings per 60s window; anonymous gets the heavier limits
const BASE_LIMITS: Record<string, { anon: number; authed: number }> = {
	auth: { anon: 30, authed: 120 },
	mutation: { anon: 60, authed: 400 },
	track: { anon: 300, authed: 600 },
	read: { anon: 400, authed: 1200 }
};

// dev + the e2e-coverage build run 50x looser so the test suite is not throttled; resolved lazily
// because isNonProdRuntime() reads runtime config, which is not ready at module-eval time
let _limits: Record<string, { anon: number; authed: number }> | null = null;
function getLimits() {
	if (_limits) return _limits;
	const scale = isNonProdRuntime() ? 50 : 1;
	_limits = Object.fromEntries(
		Object.entries(BASE_LIMITS).map(([k, v]) => [
			k,
			{ anon: v.anon * scale, authed: v.authed * scale }
		])
	);
	return _limits;
}

function classify(path: string, method: string): string {
	if (path.startsWith('/api/login') || path.startsWith('/api/setup')) return 'auth';
	if (path.startsWith('/api/analytics/track')) return 'track';
	// the infer endpoints enforce their own dual budget; keep a coarse mutation cap here too
	if (method !== 'GET' && method !== 'HEAD') return 'mutation';
	return 'read';
}

export default defineEventHandler(async (event) => {
	// no bindings during prerender; api routes are not prerendered anyway
	if (import.meta.prerender) return;
	const path = event.path || '';
	if (!path.startsWith('/api/')) return;

	const method = (event.method || 'GET').toUpperCase();
	const cls = classify(path, method);
	const user = await getCurrentUser(event).catch(() => null);
	const subject = await rateSubject(event, user);
	const limits = getLimits();
	const limit = user ? limits[cls]!.authed : limits[cls]!.anon;

	await enforceLimit(event, { cls, subject, limit, windowSeconds: 60 });
});
