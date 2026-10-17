import { and, eq, isNull } from 'drizzle-orm';
import { db } from 'hub:db';
import { trainingJobs, users } from 'hub:db:schema';
import { backgroundEnv, mailActive, MailError, sendMail } from './mail';
import { renderJobEmail } from './mail-templates';
import { siteName, siteOrigin } from './subscribers';

const NOTIFY_STATUSES = ['completed', 'failed', 'abnormal', 'aborted'] as const;

function baseModelOf(config: string): string {
	try {
		const parsed = JSON.parse(config) as { baseModel?: string };
		return parsed.baseModel || 'unknown model';
	} catch {
		return 'unknown model';
	}
}

// emails the job's author once when it reaches a terminal state; never throws, since a mail
// problem must not fail the job transition that triggered it
export async function notifyJobFinished(jobId: string): Promise<void> {
	try {
		const job = (
			await db.select().from(trainingJobs).where(eq(trainingJobs.id, jobId)).limit(1)
		)[0];
		if (
			!job?.authorId ||
			!NOTIFY_STATUSES.includes(job.status as (typeof NOTIFY_STATUSES)[number])
		) {
			return;
		}
		const author = (
			await db
				.select({
					email: users.email,
					emailConfirmedAt: users.emailConfirmedAt,
					notifyJobs: users.notifyJobs,
					isActive: users.isActive
				})
				.from(users)
				.where(eq(users.id, job.authorId))
				.limit(1)
		)[0];
		// only a confirmed address gets mail, so a typed-in address cannot be used to reach someone else
		if (!author?.email || !author.emailConfirmedAt || !author.notifyJobs || !author.isActive)
			return;

		const env = backgroundEnv();
		if (!(await mailActive(env))) return;
		const origin = await siteOrigin();
		if (!origin) return;

		// the conditional update is the claim: concurrent drivers cannot both send
		const claimed = await db
			.update(trainingJobs)
			.set({ notifiedAt: new Date() })
			.where(and(eq(trainingJobs.id, jobId), isNull(trainingJobs.notifiedAt)))
			.returning({ id: trainingJobs.id });
		if (claimed.length === 0) return;

		await sendMail(env, {
			to: author.email,
			...renderJobEmail({
				siteName: await siteName(),
				status: job.status as (typeof NOTIFY_STATUSES)[number],
				engine: job.engine,
				baseModel: baseModelOf(job.config),
				message: job.statusMessage || 'No details were recorded.',
				jobUrl: `${origin}/dashboard/training`
			})
		});
	} catch (error) {
		console.warn(
			'job notification failed',
			jobId,
			error instanceof MailError ? error.message : (error as Error)?.message
		);
	}
}
