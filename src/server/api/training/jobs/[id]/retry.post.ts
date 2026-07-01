import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { trainingJobs } from 'hub:db:schema';

// re-queue a job, reusing its config snapshot + dataset. terminal jobs re-queue directly; a still-
// running job re-queues only with `force` (it is killed first - the "Restart" action from the modal).
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No job id provided' });
	const { job } = await requireJobAccess(event, id);

	const body = (await readBody(event).catch(() => ({}))) as {
		force?: boolean;
		sudoUser?: string;
		sudoPassword?: string;
	};

	if (!isTerminalJob(job.status)) {
		if (!body.force) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Job is still running; abort it first or restart with force'
			});
		}
		// kill the live run before re-queueing it
		await abortJob(id);
	}

	// a fresh launch needs a fresh sudo password (the previous one was single-use / never persisted)
	let config: TrainingConfigView | null = null;
	try {
		config = JSON.parse(job.config) as TrainingConfigView;
	} catch {
		config = null;
	}
	if (config?.useSudo && (body.sudoUser || body.sudoPassword)) {
		await stashSudoCreds(id, {
			user: body.sudoUser || undefined,
			password: body.sudoPassword || undefined
		});
	}

	await db
		.update(trainingJobs)
		.set({
			status: 'queued',
			failureClass: 'none',
			statusMessage: 'Re-queued.',
			pid: null,
			pgid: null,
			wrapperId: null,
			startedAt: null,
			finishedAt: null,
			lastHeartbeatAt: null,
			consecutiveFailures: 0,
			adapterId: null,
			adapterSha: null,
			adapterSize: null,
			nextPollAt: null,
			updatedAt: new Date()
		})
		.where(eq(trainingJobs.id, id));

	if (typeof (event as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil === 'function') {
		(event as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(
			advanceJob(id).then(() => kickJob(id))
		);
	} else {
		void advanceJob(id).then(() => kickJob(id));
	}

	const view = await jobView(id);
	return { job: view };
});
