import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import type { CloudflareAccount } from 'hub:db:schema';
import { adapters, cloudflareAccounts } from 'hub:db:schema';

const ACCOUNT_CAP = 100;
const pushKey = (id: string) => `mylora:push:${id}`;

async function setJob(id: string, job: PushJob) {
	try {
		await kv.set(pushKey(id), job);
	} catch (e) {
		console.warn('push job write failed', e);
	}
}

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });

	const { user } = await requireAdapterAccess(event, id, 'edit');
	if (!(await hasCapability(user, 'canPublish'))) {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	if (adapter.status !== 'listed' && adapter.status !== 'failed') {
		throw createError({
			statusCode: 409,
			statusMessage: `Adapter must be listed or failed to publish (is ${adapter.status})`
		});
	}
	if (adapter.configBytes <= 0 || adapter.weightsBytes <= 0) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Both config and weights must be uploaded'
		});
	}
	if (adapter.rank > CF_MAX_RANK) {
		throw createError({
			statusCode: 400,
			statusMessage: `Rank exceeds Cloudflare maximum of ${CF_MAX_RANK}`
		});
	}
	if (adapter.weightsBytes > CF_MAX_WEIGHTS_BYTES) {
		throw createError({ statusCode: 400, statusMessage: 'Weights exceed Cloudflare maximum size' });
	}

	// choose the hosting account: explicit -> default -> first active shared with a free slot
	let account: CloudflareAccount | undefined;
	if (adapter.accountId) {
		account = (
			await db
				.select()
				.from(cloudflareAccounts)
				.where(eq(cloudflareAccounts.id, adapter.accountId))
				.limit(1)
		)[0];
	} else {
		account = (
			await db
				.select()
				.from(cloudflareAccounts)
				.where(and(eq(cloudflareAccounts.isActive, true), eq(cloudflareAccounts.isDefault, true)))
				.limit(1)
		)[0];
		if (!account) {
			account = (
				await db
					.select()
					.from(cloudflareAccounts)
					.where(
						and(
							eq(cloudflareAccounts.isActive, true),
							eq(cloudflareAccounts.shared, true),
							lt(cloudflareAccounts.adapterCount, ACCOUNT_CAP)
						)
					)
					.orderBy(asc(cloudflareAccounts.adapterCount))
					.limit(1)
			)[0];
		}
	}
	if (!account)
		throw createError({ statusCode: 409, statusMessage: 'No Cloudflare account available' });
	if (account.adapterCount >= ACCOUNT_CAP) {
		throw createError({ statusCode: 409, statusMessage: 'Hosting account is at its adapter cap' });
	}

	await assertEncryptionKey();
	const token = await decryptToken(account);
	const cfAccountId = account.accountId;
	const accountRowId = account.id;
	const existingFinetuneId = adapter.finetuneId;

	// atomic lock: only flip from listed/failed so a concurrent publish cannot double-create the
	// finetune or double-count the account; bail if another request already won the flip
	const locked = await db
		.update(adapters)
		.set({ status: 'pushing', statusMessage: null, accountId: accountRowId, updatedAt: new Date() })
		.where(and(eq(adapters.id, id), inArray(adapters.status, ['listed', 'failed'])));
	const changed =
		(locked as any)?.rowsAffected ??
		(locked as any)?.meta?.changes ??
		(locked as any)?.changes ??
		0;
	if (!changed) {
		throw createError({ statusCode: 409, statusMessage: 'A publish is already in progress' });
	}
	await setJob(id, { phase: 'create', progress: 0, attempt: 1, ts: Date.now() });

	// mark the adapter published + bump the account's slot count (used by both the happy path and
	// transient-error recovery; the 'pushing' lock guarantees this runs at most once)
	const markPublished = async (finetuneId: string) => {
		await db
			.update(adapters)
			.set({
				status: 'published',
				// lora key must match the name the finetune was registered under (the slug)
				finetuneName: adapter.slug || finetuneId,
				statusMessage: null,
				updatedAt: new Date()
			})
			.where(eq(adapters.id, id));
		await db
			.update(cloudflareAccounts)
			.set({ adapterCount: sql`${cloudflareAccounts.adapterCount} + 1`, updatedAt: new Date() })
			.where(eq(cloudflareAccounts.id, accountRowId));
		await setJob(id, { phase: 'done', progress: 100, attempt: 1, ts: Date.now() });
	};

	// run the push in the background; the handler returns immediately
	const run = async () => {
		let finetuneId = existingFinetuneId;
		try {
			// idempotent: only create if we have no finetune yet
			if (!finetuneId) {
				const ft = await createFinetune(cfAccountId, token, {
					model: adapter.baseModel,
					name: adapter.slug,
					description: adapter.description || undefined,
					public: adapter.cfPublic
				});
				finetuneId = ft.id;
				await db
					.update(adapters)
					.set({ finetuneId, updatedAt: new Date() })
					.where(eq(adapters.id, id));
			}
			await setJob(id, { phase: 'config', progress: 25, attempt: 1, ts: Date.now() });

			const configBlob = await blob.get(`adapters/${id}/adapter_config.json`);
			if (!configBlob) throw new Error('config object missing from storage');
			await uploadFinetuneAsset(cfAccountId, token, finetuneId, 'adapter_config.json', configBlob);
			await setJob(id, { phase: 'weights', progress: 60, attempt: 1, ts: Date.now() });

			const weightsBlob = await blob.get(`adapters/${id}/adapter_model.safetensors`);
			if (!weightsBlob) throw new Error('weights object missing from storage');
			await uploadFinetuneAsset(
				cfAccountId,
				token,
				finetuneId,
				'adapter_model.safetensors',
				weightsBlob
			);

			await markPublished(finetuneId);
		} catch (e) {
			const msg = describeCfError(e);
			// a dedupe conflict or a dropped connection can fire after cloudflare already committed;
			// verify the finetune actually exists before declaring failure
			if (finetuneId && (isBenignCfError(e) || isTransientCfError(e))) {
				try {
					const list = await listFinetunes(cfAccountId, token);
					const found = list.some((f) => f.id === finetuneId || f.name === adapter.slug);
					if (found) {
						await markPublished(finetuneId);
						return;
					}
				} catch (verifyError) {
					console.warn('publish verify failed', describeCfError(verifyError));
				}
			}
			await db
				.update(adapters)
				.set({ status: 'failed', statusMessage: msg, updatedAt: new Date() })
				.where(eq(adapters.id, id));
			await setJob(id, { phase: 'error', progress: 0, attempt: 1, error: msg, ts: Date.now() });
		}
	};

	if (typeof (event as any).waitUntil === 'function') (event as any).waitUntil(run());
	else void run();

	return { ok: true, status: 'pushing' };
});
