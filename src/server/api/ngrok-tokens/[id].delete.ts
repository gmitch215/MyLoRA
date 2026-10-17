import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { ngrokTokens } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No token id provided' });

	const existing = (await db.select().from(ngrokTokens).where(eq(ngrokTokens.id, id)).limit(1))[0];
	if (!existing) throw createError({ statusCode: 404, statusMessage: 'Token not found' });
	if (existing.ownerId !== user.id && user.role !== 'administrator') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	await db.delete(ngrokTokens).where(eq(ngrokTokens.id, id));
	return { ok: true };
});
