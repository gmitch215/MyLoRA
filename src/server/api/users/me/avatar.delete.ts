import { eq } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { users } from 'hub:db:schema';
import { requireAuthed } from '~/server/utils/auth';
import { invalidateUser } from '~/server/utils/cache';
import { ensureDatabase } from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	const me = await requireAuthed(event);
	await ensureDatabase();

	if (!me.avatarPathname) return { ok: true };
	try {
		await blob.del(me.avatarPathname);
	} catch (e) {
		console.warn('blob delete failed', e);
	}
	await db
		.update(users)
		.set({ avatarPathname: null, updatedAt: new Date() })
		.where(eq(users.id, me.id));
	await invalidateUser(me.id);

	return { ok: true };
});
