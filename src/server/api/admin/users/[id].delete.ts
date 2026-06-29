import { eq } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { users } from 'hub:db:schema';
import { adminCount, requireAdmin } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	const me = await requireAdmin(event);
	await ensureDatabase();

	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' });

	if (id === me.id) {
		throw createError({ statusCode: 400, statusMessage: 'Cannot delete yourself' });
	}

	const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
	const target = rows[0];
	if (!target) throw createError({ statusCode: 404, statusMessage: 'User not found' });

	const legacyPassword = useRuntimeConfig().password;
	const legacyActive = Boolean(legacyPassword) && legacyPassword !== 'password';
	if (legacyActive && target.username === 'admin') {
		throw createError({
			statusCode: 400,
			statusMessage:
				'Cannot delete the legacy admin while NUXT_PASSWORD is set - remove the env var and redeploy first'
		});
	}

	if (target.role === 'administrator' && (await adminCount()) <= 1) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Cannot delete the only administrator'
		});
	}

	// their adapters' author_id is set null by the fk on delete

	if (target.avatarPathname) {
		try {
			await blob.del(target.avatarPathname);
		} catch (e) {
			console.warn('avatar delete failed', e);
		}
	}

	await db.delete(users).where(eq(users.id, id));

	return { ok: true };
});
