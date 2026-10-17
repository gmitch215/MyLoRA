import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { users } from 'hub:db:schema';
import { cloudflareEnv, mailActive } from '~/server/utils/mail';
import type { NotificationPrefs } from '~/shared/types';

export default defineEventHandler(async (event): Promise<NotificationPrefs> => {
	const me = await requireAuthed(event);
	await ensureDatabase();

	const row = (
		await db
			.select({
				email: users.email,
				emailConfirmedAt: users.emailConfirmedAt,
				notifyJobs: users.notifyJobs
			})
			.from(users)
			.where(eq(users.id, me.id))
			.limit(1)
	)[0];

	return {
		email: row?.email ?? '',
		emailConfirmed: !!row?.emailConfirmedAt,
		notifyJobs: row?.notifyJobs ?? false,
		mailEnabled: await mailActive(cloudflareEnv(event))
	};
});
