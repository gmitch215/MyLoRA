import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { users } from 'hub:db:schema';
import { tryCache, userCacheKey } from '~/server/utils/cache';
import { ensureDatabase } from '~/server/utils/db';

export default defineNitroPlugin(() => {
	sessionHooks.hook('fetch', async (session, event) => {
		if (!session?.user?.id) return;

		let fresh;
		try {
			await ensureDatabase();
			// this fires on EVERY authed request (via the ratelimit middleware); cache the row so it is
			// a cheap kv read, not a d1 query, each time. busted on user edits (see invalidateUser)
			fresh = await tryCache(
				userCacheKey(session.user.id),
				async () => {
					const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
					return rows[0] ?? null;
				},
				30
			);
		} catch (e) {
			console.warn('session-hooks fetch lookup failed, leaving session intact', e);
			return;
		}

		if (!fresh) {
			await clearUserSession(event);
			return;
		}

		// only invalidate when isActive is explicitly false/0
		const deactivated =
			fresh.isActive === false || (fresh.isActive as any) === 0 || fresh.isActive === null;
		if (deactivated) {
			await clearUserSession(event);
			return;
		}

		session.user = {
			id: fresh.id,
			username: fresh.username,
			displayName: fresh.displayName,
			role: fresh.role,
			avatarPathname: fresh.avatarPathname,
			bio: fresh.bio
		};
	});
});
