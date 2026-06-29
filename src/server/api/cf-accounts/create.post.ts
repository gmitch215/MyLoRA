import { eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { cloudflareAccounts } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageAccounts');
	await ensureDatabase();

	const body = await readBody(event);
	const parsed = cloudflareAccountSchema.safeParse(body);
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid account data')
		});
	}
	const data = parsed.data;

	await assertEncryptionKey();

	// validate by listing the account's finetunes (proves token + account id + workers ai access);
	// reject invalid accounts before storing anything or wiring them into the registry
	const validation = await validateAccount(data.accountId, data.apiToken);
	if (!validation.ok) {
		throw createError({
			statusCode: 400,
			statusMessage: `Cloudflare validation failed: ${validation.error}`
		});
	}

	const enc = await encryptToken(data.apiToken);
	const id = crypto.randomUUID().replace(/-/g, '');

	// only one default account; clear the rest first
	if (data.isDefault) {
		await db
			.update(cloudflareAccounts)
			.set({ isDefault: false, updatedAt: new Date() })
			.where(eq(cloudflareAccounts.isDefault, true));
	}

	await db.insert(cloudflareAccounts).values({
		id,
		label: data.label,
		accountId: data.accountId,
		tokenCipher: enc.tokenCipher,
		tokenIv: enc.tokenIv,
		dekCipher: enc.dekCipher,
		dekIv: enc.dekIv,
		tokenLast4: enc.tokenLast4,
		tokenScope: data.tokenScope,
		ownerId: user.id,
		shared: data.shared,
		isDefault: data.isDefault
	});

	// import any pre-existing finetunes as 'migrated' adapters (testable + visible, not downloadable)
	const imported = await importFinetunes({
		accountRowId: id,
		finetunes: validation.finetunes,
		ownerId: user.id
	});
	if (imported > 0) {
		await db
			.update(cloudflareAccounts)
			.set({
				adapterCount: sql`${cloudflareAccounts.adapterCount} + ${imported}`,
				updatedAt: new Date()
			})
			.where(eq(cloudflareAccounts.id, id));
	}

	const row = (
		await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).limit(1)
	)[0];
	return { ...redactAccount(row!), imported };
});
