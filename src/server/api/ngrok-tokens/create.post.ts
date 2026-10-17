import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { ngrokTokens } from 'hub:db:schema';
import { redactNgrokToken } from '~/server/utils/ngrok-tokens';
import { firstZodIssueMessage, ngrokTokenSchema } from '~/shared/schemas';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const parsed = ngrokTokenSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid ngrok token')
		});
	}
	const data = parsed.data;

	await assertEncryptionKey();
	const enc = await encryptToken(data.token);
	const id = crypto.randomUUID().replace(/-/g, '');

	// one default per owner
	if (data.isDefault) {
		await db
			.update(ngrokTokens)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(and(eq(ngrokTokens.ownerId, user.id), eq(ngrokTokens.isDefault, true)));
	}

	await db.insert(ngrokTokens).values({
		id,
		label: data.label,
		...enc,
		ownerId: user.id,
		shared: data.shared,
		isDefault: data.isDefault
	});
	const row = (await db.select().from(ngrokTokens).where(eq(ngrokTokens.id, id)).limit(1))[0]!;
	return redactNgrokToken(row);
});
