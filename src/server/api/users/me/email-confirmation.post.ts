import { sendEmailConfirmation } from '~/server/utils/email-confirm';
import { cloudflareEnv } from '~/server/utils/mail';

export default defineEventHandler(async (event) => {
	const me = await requireAuthed(event);
	await ensureDatabase();

	const outcome = await sendEmailConfirmation(cloudflareEnv(event), me.id);
	if (outcome === 'cooldown') {
		throw createError({
			statusCode: 429,
			statusMessage: 'A confirmation email was sent recently, try again in a few minutes'
		});
	}
	if (outcome === 'not-ready') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Add an email address first, and make sure email is set up on this site'
		});
	}
	return { outcome };
});
