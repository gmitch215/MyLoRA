import { requireAuthed } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';
import { runSummary } from '~/server/utils/inference';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	await requireAuthed(event);

	const body = await readBody(event);
	const text = typeof body?.text === 'string' ? body.text : '';
	if (!text.trim()) {
		throw createError({ statusCode: 400, statusMessage: 'text is required' });
	}

	const requested = Number(body?.maxLength);
	const maxLength = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : undefined;

	const summary = await runSummary(event, text, { maxLength });
	return { summary };
});
