import { ensureDatabase } from '~/server/utils/db';
import { confirmUserEmail } from '~/server/utils/email-confirm';
import { subscriberLinkSchema } from '~/shared/schemas';

// opened from the mailed link, possibly in another browser, so it takes the signed token and no session
export default defineEventHandler(async (event) => {
	await ensureDatabase();

	const parsed = subscriberLinkSchema.safeParse(await readBody(event));
	if (!parsed.success || !(await confirmUserEmail(parsed.data.id, parsed.data.token))) {
		throw createError({ statusCode: 400, statusMessage: 'This link is invalid or has expired' });
	}
	return { ok: true };
});
