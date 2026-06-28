import { requireAdapterAccess } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';

// ~90MB worker request body ceiling; larger weights must go browser -> r2 directly
const MAX_WORKER_BYTES = 90 * 1024 * 1024;

// TODO: issue a real r2 multipart/presigned target for direct browser -> r2 weights upload
// (NuxtHub blob.handleMultipartUpload / createMultipartUpload). worker-proxied upload.post is
// the working path until this is wired up.
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No adapter id provided' });
	await requireAdapterAccess(event, id, 'edit');

	return {
		supported: false,
		maxWorkerBytes: MAX_WORKER_BYTES,
		message:
			'Direct presigned upload is not enabled yet; upload weights under 90MB via the standard upload endpoint.'
	};
});
