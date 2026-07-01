import { eq } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { trainingJobs } from 'hub:db:schema';

// delete a training job from the history. a still-running job is killed first, then the row + its R2
// artifacts (logs/weights) + any transient sudo stash are removed. a trained adapter row is left intact.
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No job id provided' });
	const { job } = await requireJobAccess(event, id);

	if (!isTerminalJob(job.status)) await abortJob(id);
	await clearSudoPassword(id);

	// best-effort R2 cleanup under jobs/<id>/
	try {
		const listed = (await blob.list({ prefix: `jobs/${id}/`, limit: 1000 })) as {
			blobs?: { pathname: string }[];
		};
		const keys = (listed?.blobs ?? []).map((b) => b.pathname);
		if (keys.length) await blob.del(keys).catch(() => {});
	} catch {
		// ignore cleanup failures; the row removal is the important part
	}

	await db.delete(trainingJobs).where(eq(trainingJobs.id, id));
	return { ok: true };
});
