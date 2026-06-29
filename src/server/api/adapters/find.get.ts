import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, users } from 'hub:db:schema';
import { getCurrentUser, hasCapability } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';
import { toAdapter } from '~/server/utils/serialize';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const { slug } = getQuery(event);
	if (!slug || typeof slug !== 'string') {
		throw createError({ statusCode: 400, statusMessage: 'No valid slug provided' });
	}

	const rows = await db
		.select()
		.from(adapters)
		.leftJoin(users, eq(adapters.authorId, users.id))
		.where(eq(adapters.slug, slug))
		.limit(1);
	const row = rows[0];
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const adapter = row.adapters;
	const user = await getCurrentUser(event);
	const isOwner = !!user && !!adapter.authorId && adapter.authorId === user.id;
	const canEditAny = !!user && (await hasCapability(user, 'canEditAny'));

	// archived is hidden from everyone but the owner/admin
	if (adapter.status === 'archived' && !isOwner && !canEditAny) {
		throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	}
	// private requires owner or edit-any
	if (adapter.visibility === 'private' && !isOwner && !canEditAny) {
		throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	}

	return toAdapter(adapter, row.users);
});
