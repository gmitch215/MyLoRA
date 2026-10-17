import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { users } from 'hub:db:schema';
import { kv } from 'hub:kv';
import { signLinkToken, verifyLinkToken } from './crypto';
import { mailActive, MailError, sendMail, type MailEnv } from './mail';
import { renderEmailConfirmEmail } from './mail-templates';
import { siteName, siteOrigin } from './subscribers';
import { hashKey } from './ua';

const RESEND_COOLDOWN_SECONDS = 10 * 60;

// the signed id covers the address, so a link for an old address stops working after a change
async function linkId(userId: string, email: string): Promise<string> {
	return `${userId}.${await hashKey(`email:${email.toLowerCase()}`)}`;
}

export type ConfirmationOutcome = 'sent' | 'cooldown' | 'not-ready' | 'confirmed';

/** Mails the confirmation link for the user's current address; a no-op when mail is off. */
export async function sendEmailConfirmation(
	env: MailEnv,
	userId: string,
	opts: { force?: boolean } = {}
): Promise<ConfirmationOutcome> {
	const row = (
		await db
			.select({ email: users.email, confirmedAt: users.emailConfirmedAt })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
	)[0];
	if (!row?.email) return 'not-ready';
	if (row.confirmedAt) return 'confirmed';
	if (!(await mailActive(env))) return 'not-ready';
	const origin = await siteOrigin();
	if (!origin) return 'not-ready';

	const key = `mylora:rl:email-confirm:${userId}`;
	if (!opts.force && (await kv.get(key))) return 'cooldown';

	const token = await signLinkToken('email', await linkId(userId, row.email));
	try {
		await sendMail(env, {
			to: row.email,
			...renderEmailConfirmEmail({
				siteName: await siteName(),
				confirmUrl: `${origin}/confirm-email?id=${userId}&token=${token}`
			})
		});
	} catch (error) {
		if (error instanceof MailError) {
			console.warn('email confirmation failed', userId, error.message);
			return 'not-ready';
		}
		throw error;
	}
	await kv.set(key, '1', { ttl: RESEND_COOLDOWN_SECONDS });
	return 'sent';
}

export async function confirmUserEmail(userId: string, token: string): Promise<boolean> {
	const row = (
		await db
			.select({ email: users.email, confirmedAt: users.emailConfirmedAt })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1)
	)[0];
	if (!row?.email) return false;
	if (!(await verifyLinkToken('email', await linkId(userId, row.email), token))) return false;
	if (!row.confirmedAt) {
		await db.update(users).set({ emailConfirmedAt: new Date() }).where(eq(users.id, userId));
	}
	return true;
}
