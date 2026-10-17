import { db } from 'hub:db';
import { inferenceEndpoints } from 'hub:db:schema';
import {
	encryptEndpointKey,
	loadEndpoint,
	redactEndpoint,
	validatedBaseUrl
} from '~/server/utils/endpoints';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const parsed = endpointCreateSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid endpoint data')
		});
	}
	const data = parsed.data;
	const baseUrl = await validatedBaseUrl(data.baseUrl);
	await assertEncryptionKey();

	const id = crypto.randomUUID().replace(/-/g, '');
	const key = data.apiKey?.trim();
	await db.insert(inferenceEndpoints).values({
		id,
		label: data.label,
		ownerId: user.id,
		shared: data.shared,
		source: 'external',
		baseUrl,
		defaultModel: data.defaultModel?.trim() || null,
		...(key ? await encryptEndpointKey(key) : {})
	});

	const row = (await loadEndpoint(id))!;
	return redactEndpoint(row);
});
