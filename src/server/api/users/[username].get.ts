import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, users } from '~/server/db/schema';
import { ensureDatabase } from '~/server/utils/db';
import { toAdapter, toPublicUser } from '~/server/utils/serialize';

export default defineEventHandler(async (event) => {
	await ensureDatabase();

	const usernameParam = getRouterParam(event, 'username');
	if (!usernameParam) {
		throw createError({ statusCode: 400, statusMessage: 'Username required' });
	}
	const username = usernameParam.toLowerCase();

	const rows = await db
		.select()
		.from(users)
		.where(and(eq(users.username, username), eq(users.isActive, true)))
		.limit(1);

	const user = rows[0];
	if (!user) {
		throw createError({ statusCode: 404, statusMessage: 'User not found' });
	}

	const authorPublic = toPublicUser(user)!;

	// only public, downloadable-or-published adapters are exposed on a profile
	const rowsAdapters = await db
		.select()
		.from(adapters)
		.where(
			and(
				eq(adapters.authorId, user.id),
				eq(adapters.visibility, 'public'),
				inArray(adapters.status, ['listed', 'published', 'migrated'])
			)
		)
		.orderBy(desc(adapters.createdAt));

	const mapped = rowsAdapters.map((row) => toAdapter(row, user));

	return {
		author: authorPublic,
		adapters: mapped
	};
});
