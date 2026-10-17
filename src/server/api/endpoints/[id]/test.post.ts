import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { inferenceEndpoints } from 'hub:db:schema';
import { probeEndpoint } from '~/server/utils/endpoint-client';
import { decryptEndpointKey, loadEndpoint, redactEndpoint } from '~/server/utils/endpoints';

// GET /models against the saved url and key; records the result so the list shows it
export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const id = getRouterParam(event, 'id') ?? '';
	const row = await loadEndpoint(id);
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Endpoint not found' });
	if (!row.shared && row.ownerId !== user.id && user.role !== 'administrator') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}
	if (!row.baseUrl) {
		throw createError({ statusCode: 409, statusMessage: 'The endpoint has no URL yet' });
	}

	const result = await probeEndpoint({
		baseUrl: row.baseUrl,
		apiKey: await decryptEndpointKey(row)
	});
	await db
		.update(inferenceEndpoints)
		.set({
			health: result.health,
			lastDiagnosis: result.message,
			lastCheckedAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(inferenceEndpoints.id, id));

	return { endpoint: redactEndpoint((await loadEndpoint(id))!), models: result.models };
});
