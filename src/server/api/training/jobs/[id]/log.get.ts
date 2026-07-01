import { eq } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

// full train.log for the live modal stream + download. a terminal job reads the persisted R2 copy;
// a live job reads the box directly over ssh, falling back to the persisted copy / the stored tail.
async function blobText(key: string): Promise<string> {
	const obj = await blob.get(key);
	if (!obj) return '';
	return new TextDecoder().decode(new Uint8Array(await obj.arrayBuffer()));
}

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No job id provided' });
	const { job } = await requireJobAccess(event, id);
	const download = String(getQuery(event).download ?? '') === '1';

	let text = '';
	if (isTerminalJob(job.status)) {
		text = (await blobText(`jobs/${id}/train.log`)) || (job.logTail ?? '');
	} else if (job.machineId) {
		const m = (await db.select().from(machines).where(eq(machines.id, job.machineId)).limit(1))[0];
		if (m) {
			try {
				text = await fetchRemoteLog(await resolveMachineCreds(m), id);
				// cache the live log to R2 so it survives the box being wiped (lifecycle persistence)
				if (text) {
					await blob
						.put(`jobs/${id}/train.log`, new TextEncoder().encode(text), {
							contentType: 'text/plain; charset=utf-8'
						})
						.catch(() => {});
				}
			} catch {
				// fall back to the persisted copy / tail below
			}
		}
		if (!text) text = (await blobText(`jobs/${id}/train.log`)) || (job.logTail ?? '');
	} else {
		text = job.logTail ?? '';
	}

	if (download) {
		setHeader(event, 'content-type', 'text/plain; charset=utf-8');
		setHeader(event, 'content-disposition', `attachment; filename="train-${id}.log"`);
		return text;
	}
	return { log: text, status: job.status };
});
