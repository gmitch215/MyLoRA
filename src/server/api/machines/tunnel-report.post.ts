import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	await enforceLimit(event, {
		cls: 'tunnel-report',
		subject: await rateSubject(event, null),
		limit: 30,
		windowSeconds: 60
	});
	await ensureDatabase();

	const parsed = tunnelSelfReportSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid report')
		});
	}
	const { token, host, port } = parsed.data;
	const hash = await hashSelfReportToken(token);
	const row = (
		await db.select().from(machines).where(eq(machines.selfReportTokenHash, hash)).limit(1)
	)[0];
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Unknown self-report token' });

	await db
		.update(machines)
		.set({ host, port, updatedAt: new Date() })
		.where(eq(machines.id, row.id));
	return { ok: true };
});
