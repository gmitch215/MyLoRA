import { activeJobIds, advanceJob, POLL_INTERVAL_MS, purgeExpiredLogs } from '../utils/training';

// advance a list of jobs with bounded concurrency
async function drive(ids: string[], limit = 5) {
	let i = 0;
	async function worker() {
		while (i < ids.length) {
			const id = ids[i++];
			if (!id) continue; // shouldn't happen, but just in case

			try {
				await advanceJob(id);
			} catch (e) {
				console.warn('scheduler advanceJob failed', id, (e as Error)?.message);
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
}

export default defineNitroPlugin((nitroApp) => {
	// cron: primary scheduler
	nitroApp.hooks.hook('cloudflare:scheduled', async ({ env }) => {
		(globalThis as { __env__?: unknown }).__env__ = env;
		try {
			await ensureDatabase();
			const ids = await activeJobIds();
			if (ids.length) await drive(ids);
			// self-throttled (~every 6h): purge R2 logs past the retention window
			await purgeExpiredLogs();
		} catch (e) {
			console.warn('cron scheduler error', (e as Error)?.message);
		}
	});

	// durable-object alarm: opportunistic per-job driver
	nitroApp.hooks.hook('cloudflare:durable:alarm', async (durable) => {
		const d = durable as unknown as {
			env: unknown;
			ctx: { storage: { get(k: string): Promise<unknown>; setAlarm(t: number): Promise<void> } };
		};
		(globalThis as { __env__?: unknown }).__env__ = d.env;
		try {
			const jobId = (await d.ctx.storage.get('jobId')) as string | undefined;
			if (!jobId) return;
			await ensureDatabase();
			await advanceJob(jobId);

			// reschedule until the job reaches a terminal state
			const stillActive = (await activeJobIds()).includes(jobId);
			if (stillActive) await d.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
		} catch (e) {
			console.warn('alarm scheduler error', (e as Error)?.message);
		}
	});
});
