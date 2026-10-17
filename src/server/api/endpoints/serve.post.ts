import { loadEndpoint, redactEndpoint } from '~/server/utils/endpoints';
import { advanceServe, startServe } from '~/server/utils/serve';
import { firstZodIssueMessage, serveStartSchema } from '~/shared/schemas';

// starts vLLM with LoRA on a registered machine and registers it as an endpoint
export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const parsed = serveStartSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid server settings')
		});
	}
	const { machine } = await requireMachineAccess(event, parsed.data.machineId, 'use');

	const { canEditAny } = await capabilitiesFor(user.role);
	const row = await startServe({ id: user.id, canEditAny }, machine, parsed.data);
	// take the first step now so the page shows provisioning instead of a long queue
	await advanceServe(row.id).catch((e) => console.warn('serve first step failed', e?.message));
	return redactEndpoint((await loadEndpoint(row.id))!, 0, { withLog: true });
});
