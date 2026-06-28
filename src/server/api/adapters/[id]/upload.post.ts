import { eq } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { adapters } from '~/server/db/schema';
import { requireAdapterAccess } from '~/server/utils/auth';
import { canonicalizeAdapterConfig, readRankFromConfig } from '~/server/utils/cloudflare';
import { ensureDatabase } from '~/server/utils/db';
import { getLimits } from '~/server/utils/settings';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	await requireAdapterAccess(event, id, 'edit');

	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const form = await readFormData(event);
	const asset = form.get('asset');
	const file = form.get('file');
	if (asset !== 'config' && asset !== 'weights') {
		throw createError({ statusCode: 400, statusMessage: "asset must be 'config' or 'weights'" });
	}
	if (!(file instanceof Blob)) {
		throw createError({ statusCode: 400, statusMessage: 'No file provided' });
	}

	const limits = await getLimits();
	let configBytes = adapter.configBytes;
	let weightsBytes = adapter.weightsBytes;

	if (asset === 'config') {
		const raw = await file.text();
		// always overwrite model_type from our metadata; never trust the file
		const { json } = canonicalizeAdapterConfig(raw, adapter.modelType);
		const rank = readRankFromConfig(json);
		if (rank != null && rank > limits.maxRank) {
			throw createError({
				statusCode: 400,
				statusMessage: `Adapter rank ${rank} exceeds the maximum of ${limits.maxRank}`
			});
		}
		await blob.put(`adapters/${id}/adapter_config.json`, json, {
			contentType: 'application/json'
		});
		configBytes = new TextEncoder().encode(json).length;
	} else {
		if (file.size > limits.maxWeightsBytes) {
			throw createError({
				statusCode: 413,
				statusMessage:
					'Weights exceed the worker upload limit; use the presigned upload for very large files'
			});
		}
		const name = (file as any).name ?? '';
		if (!String(name).endsWith('.safetensors')) {
			throw createError({ statusCode: 400, statusMessage: 'Weights must be a .safetensors file' });
		}
		await blob.put(`adapters/${id}/adapter_model.safetensors`, file, {
			contentType: 'application/octet-stream'
		});
		weightsBytes = file.size;
	}

	// promote draft to listed once both files are present
	let status = adapter.status;
	if (configBytes > 0 && weightsBytes > 0 && status === 'draft') status = 'listed';

	await db
		.update(adapters)
		.set({ configBytes, weightsBytes, status, updatedAt: new Date() })
		.where(eq(adapters.id, id));

	return { ok: true, status, configBytes, weightsBytes };
});
