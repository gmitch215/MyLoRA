import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { ngrokTokens } from 'hub:db:schema';
import { redactNgrokToken } from '~/server/utils/ngrok-tokens';
import { firstZodIssueMessage, ngrokTokenUpdateSchema } from '~/shared/schemas';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No token id provided' });

	const parsed = ngrokTokenUpdateSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid ngrok token')
		});
	}
	const data = parsed.data;

	const existing = (await db.select().from(ngrokTokens).where(eq(ngrokTokens.id, id)).limit(1))[0];
	if (!existing) throw createError({ statusCode: 404, statusMessage: 'Token not found' });
	// a shared token stays visible to others but only its owner (or an administrator) changes it
	if (existing.ownerId !== user.id && user.role !== 'administrator') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (data.label !== undefined) patch.label = data.label;
	if (data.shared !== undefined) patch.shared = data.shared;
	if (data.isActive !== undefined) patch.isActive = data.isActive;
	if (data.token) {
		await assertEncryptionKey();
		Object.assign(patch, await encryptToken(data.token));
	}
	if (data.isDefault === true) {
		await db
			.update(ngrokTokens)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(
				and(
					eq(ngrokTokens.ownerId, existing.ownerId ?? ''),
					eq(ngrokTokens.isDefault, true),
					ne(ngrokTokens.id, id)
				)
			);
		patch.isDefault = true;
	} else if (data.isDefault === false) {
		patch.isDefault = false;
	}

	await db.update(ngrokTokens).set(patch).where(eq(ngrokTokens.id, id));
	const row = (await db.select().from(ngrokTokens).where(eq(ngrokTokens.id, id)).limit(1))[0]!;
	return redactNgrokToken(row);
});
