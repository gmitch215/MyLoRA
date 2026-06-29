import { getCurrentUser } from '~/server/utils/auth';
import { enforceLimit, rateSubject } from '~/server/utils/ratelimit';

// per-class ceilings per 60s window; anonymous gets the heavier limits
const BASE_LIMITS: Record<string, { anon: number; authed: number }> = {
	auth: { anon: 30, authed: 120 },
	mutation: { anon: 60, authed: 400 },
	track: { anon: 300, authed: 600 },
	read: { anon: 400, authed: 1200 }
};

const SCALE = process.env.NODE_ENV === 'production' ? 1 : 50;
const LIMITS: Record<string, { anon: number; authed: number }> = Object.fromEntries(
	Object.entries(BASE_LIMITS).map(([k, v]) => [
		k,
		{ anon: v.anon * SCALE, authed: v.authed * SCALE }
	])
);

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
	const limit = user ? LIMITS[cls]!.authed : LIMITS[cls]!.anon;

	await enforceLimit(event, { cls, subject, limit, windowSeconds: 60 });
});
