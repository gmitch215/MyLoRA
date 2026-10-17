import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { inferenceEndpoints } from 'hub:db:schema';
import {
	adapterCounts,
	encryptEndpointKey,
	loadEndpoint,
	redactEndpoint,
	validatedBaseUrl
} from '~/server/utils/endpoints';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id') ?? '';
	const row = await loadEndpoint(id);
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Endpoint not found' });
	if (row.ownerId !== user.id && user.role !== 'administrator') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	const parsed = endpointUpdateSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid endpoint data')
		});
	}
	const data = parsed.data;

	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (data.label !== undefined) patch.label = data.label;
	if (data.shared !== undefined) patch.shared = data.shared;
	if (data.isActive !== undefined) patch.isActive = data.isActive;
	if (data.defaultModel !== undefined) patch.defaultModel = data.defaultModel.trim() || null;
	// a serve job owns its url and key, so only an external endpoint takes those edits
	if (row.source === 'external') {
		if (data.baseUrl !== undefined) {
			patch.baseUrl = await validatedBaseUrl(data.baseUrl);
			patch.health = 'unchecked';
		}
		const key = data.apiKey?.trim();
		if (key) {
			await assertEncryptionKey();
			Object.assign(patch, await encryptEndpointKey(key));
			patch.health = 'unchecked';
		}
	}

	await db.update(inferenceEndpoints).set(patch).where(eq(inferenceEndpoints.id, id));
	const next = (await loadEndpoint(id))!;
	return redactEndpoint(next, (await adapterCounts()).get(id) ?? 0);
});
