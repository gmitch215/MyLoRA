import { eq, sql } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { adapters, cloudflareAccounts } from 'hub:db:schema';
import { requireAdapterAccess } from '~/server/utils/auth';
import { CfUnsupported, deleteFinetune, describeCfError } from '~/server/utils/cloudflare';
import { decryptToken } from '~/server/utils/crypto';
import { ensureDatabase } from '~/server/utils/db';
import { getFeatures } from '~/server/utils/settings';

// drop every r2 object for an adapter (config, weights, screenshots)
async function dropBlobs(adapter: { id: string; screenshots: string | null }) {
	const keys = [
		`adapters/${adapter.id}/adapter_config.json`,
		`adapters/${adapter.id}/adapter_model.safetensors`
	];
	try {
		const shots = adapter.screenshots ? (JSON.parse(adapter.screenshots) as string[]) : [];
		for (const s of shots) if (s) keys.push(s);
	} catch {
		// ignore malformed screenshots json
	}
	try {
		await blob.del(keys);
	} catch (e) {
		console.warn('blob delete failed', e);
	}
}

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const { id } = getQuery(event);
	if (!id || typeof id !== 'string') {
		throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	}
	await requireAdapterAccess(event, id, 'delete');

	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const features = await getFeatures();
	let reclaimed = false;

	if (features.cfDeleteEnabled && adapter.finetuneId && adapter.accountId) {
		const accRows = await db
			.select()
			.from(cloudflareAccounts)
			.where(eq(cloudflareAccounts.id, adapter.accountId))
			.limit(1);
		const account = accRows[0];
		if (account) {
			try {
				const token = await decryptToken(account);
				await deleteFinetune(account.accountId, token, adapter.finetuneId, true);
				await db
					.update(cloudflareAccounts)
					.set({
						adapterCount: sql`MAX(0, ${cloudflareAccounts.adapterCount} - 1)`,
						updatedAt: new Date()
					})
					.where(eq(cloudflareAccounts.id, account.id));
				reclaimed = true;
			} catch (e) {
				if (e instanceof CfUnsupported) reclaimed = false;
				else
					throw createError({
						statusCode: 502,
						statusMessage: `Cloudflare delete failed: ${describeCfError(e)}`
					});
			}
		}
	}

	if (reclaimed) {
		// slot reclaimed on cloudflare: hard-delete row + all r2 objects
		await dropBlobs(adapter);
		await db.delete(adapters).where(eq(adapters.id, id));
		return { ok: true, reclaimed: true };
	}

	// soft-delete: archive, drop r2 objects, keep finetuneId so the slot is never reissued
	await dropBlobs(adapter);
	await db
		.update(adapters)
		.set({
			status: 'archived',
			configBytes: 0,
			weightsBytes: 0,
			screenshots: '[]',
			updatedAt: new Date()
		})
		.where(eq(adapters.id, id));
	return { ok: true, reclaimed: false };
});
