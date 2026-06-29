import { eq, sql } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { adapters, downloads } from 'hub:db:schema';
import { getCurrentUser, hasCapability } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';
import { getAccess } from '~/server/utils/settings';
import { clientIp, ipHash } from '~/server/utils/ua';

const ASSETS = {
	config: {
		key: 'adapter_config.json',
		filename: 'adapter_config.json',
		contentType: 'application/json'
	},
	weights: {
		key: 'adapter_model.safetensors',
		filename: 'adapter_model.safetensors',
		contentType: 'application/octet-stream'
	}
} as const;

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	const assetParam = getRouterParam(event, 'asset');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	if (assetParam !== 'config' && assetParam !== 'weights') {
		throw createError({ statusCode: 400, statusMessage: "asset must be 'config' or 'weights'" });
	}
	const spec = ASSETS[assetParam];

	const access = await getAccess();
	const user = await getCurrentUser(event);
	if (access.downloadAccess === 'login' && !user) {
		throw createError({ statusCode: 401, statusMessage: 'Login required to download' });
	}

	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const isOwner = !!user && !!adapter.authorId && adapter.authorId === user.id;
	const canEditAny = !!user && (await hasCapability(user, 'canEditAny'));
	const privileged = isOwner || canEditAny;
	// private adapters and non-listed/published ones (draft/pushing/archived) are owner-only
	const downloadable = adapter.status === 'listed' || adapter.status === 'published';
	if ((adapter.visibility === 'private' || !downloadable) && !privileged) {
		throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	}

	const object = await blob.get(`adapters/${id}/${spec.key}`);
	if (!object) throw createError({ statusCode: 404, statusMessage: 'Asset not found' });

	// count the download (best-effort; never block the stream on it)
	try {
		const salt = useRuntimeConfig().analyticsSalt;
		const hash = await ipHash(clientIp(event), salt);
		const day = new Date().toISOString().slice(0, 10);
		await db
			.update(adapters)
			.set({ downloadCount: sql`${adapters.downloadCount} + 1` })
			.where(eq(adapters.id, id));
		await db.insert(downloads).values({
			id: crypto.randomUUID().replace(/-/g, ''),
			adapterId: id,
			asset: assetParam,
			ipHash: hash,
			day
		});
	} catch (e) {
		console.warn('download tracking failed', e);
	}

	setHeader(event, 'Content-Type', spec.contentType);
	setHeader(event, 'Content-Disposition', `attachment; filename="${spec.filename}"`);
	setHeader(event, 'Cache-Control', 'no-cache, no-store, must-revalidate');
	if (object.size) setHeader(event, 'Content-Length', object.size);

	return object.stream();
});
