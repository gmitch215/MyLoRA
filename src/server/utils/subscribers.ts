import { and, asc, desc, eq, gt, inArray, like, lt, sql } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { db } from 'hub:db';
import { adapters, mailOutbox, subscribers } from 'hub:db:schema';
import { kv } from 'hub:kv';
import { screenshotUrl, type SubscriberRow } from '~/shared/types';
import { runtimeConfig } from './config';
import { signLinkToken, verifyLinkToken } from './crypto';
import { mailActive, readStoredMail, sendMail, type MailEnv } from './mail';
import { renderAdapterEmail, renderConfirmEmail } from './mail-templates';

const ORIGIN_KV_KEY = 'mylora:setting:site_origin';
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const SENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CONFIRM_COOLDOWN_MS = 10 * 60 * 1000;

/** Worker subrequests are capped per invocation, so one drain sends a bounded batch. */
export const DRAIN_BATCH = 25;

export type DrainResult = { sent: number; retried: number; failed: number; remaining: number };

export async function siteOrigin(): Promise<string> {
	const configured = runtimeConfig().public.site_url;
	if (configured) return configured.replace(/\/+$/, '');
	return ((await kv.get<string>(ORIGIN_KV_KEY)) || '').replace(/\/+$/, '');
}

/**
 * Scheduled sends have no request, so an administrator's origin is kept for them. Only call this
 * from an admin route: a client-controlled Host header would otherwise rewrite every email link.
 */
export async function rememberOrigin(event: H3Event): Promise<void> {
	const origin = getRequestURL(event).origin;
	if (!runtimeConfig().public.site_url && (await kv.get<string>(ORIGIN_KV_KEY)) !== origin) {
		await kv.set(ORIGIN_KV_KEY, origin);
	}
}

export async function siteName(): Promise<string> {
	return (await kv.get<string>('mylora:setting:name')) || runtimeConfig().public.name || 'MyLoRA';
}

export async function confirmUrl(origin: string, id: string): Promise<string> {
	const token = await signLinkToken('confirm', id);
	return `${origin}/subscribe/confirm?id=${id}&token=${token}`;
}

export async function unsubscribeUrls(
	origin: string,
	id: string
): Promise<{ page: string; oneClick: string }> {
	const token = await signLinkToken('unsubscribe', id);
	return {
		page: `${origin}/unsubscribe?id=${id}&token=${token}`,
		oneClick: `${origin}/api/subscribers/unsubscribe?id=${id}&token=${token}`
	};
}

export async function checkLink(
	purpose: 'confirm' | 'unsubscribe',
	id: string,
	token: string
): Promise<boolean> {
	return verifyLinkToken(purpose, id, token);
}

// #region subscribers

export type SubscribeOutcome = 'confirmation-sent' | 'already-active' | 'cooldown';

export async function subscribe(
	env: MailEnv,
	email: string,
	origin: string
): Promise<SubscribeOutcome> {
	const address = email.trim().toLowerCase();
	const now = new Date();
	const existing = (
		await db.select().from(subscribers).where(eq(subscribers.email, address)).limit(1)
	)[0];

	if (existing?.status === 'active') return 'already-active';
	if (
		existing?.confirmationSentAt &&
		now.getTime() - existing.confirmationSentAt.getTime() < CONFIRM_COOLDOWN_MS
	) {
		return 'cooldown';
	}

	const id = existing?.id ?? crypto.randomUUID().replace(/-/g, '');
	// build the message before touching the table, so a missing secret leaves nothing behind
	const message = renderConfirmEmail({
		siteName: await siteName(),
		confirmUrl: await confirmUrl(origin, id)
	});

	if (!existing) {
		await db.insert(subscribers).values({ id, email: address, createdAt: now });
	}
	try {
		await sendMail(env, { to: address, ...message });
	} catch (error) {
		// a new address that never got its email is not a pending subscriber
		if (!existing) await db.delete(subscribers).where(eq(subscribers.id, id));
		throw error;
	}
	await db.update(subscribers).set({ confirmationSentAt: now }).where(eq(subscribers.id, id));
	return 'confirmation-sent';
}

export async function confirmSubscriber(id: string): Promise<boolean> {
	const rows = await db
		.update(subscribers)
		.set({ status: 'active', confirmedAt: new Date() })
		.where(and(eq(subscribers.id, id), eq(subscribers.status, 'pending')))
		.returning({ id: subscribers.id });
	if (rows.length > 0) return true;
	const active = await db
		.select({ id: subscribers.id })
		.from(subscribers)
		.where(and(eq(subscribers.id, id), eq(subscribers.status, 'active')))
		.limit(1);
	return active.length > 0;
}

export async function removeSubscriber(id: string): Promise<boolean> {
	await db.delete(mailOutbox).where(eq(mailOutbox.subscriberId, id));
	const rows = await db
		.delete(subscribers)
		.where(eq(subscribers.id, id))
		.returning({ id: subscribers.id });
	return rows.length > 0;
}

function toRow(row: typeof subscribers.$inferSelect): SubscriberRow {
	return {
		id: row.id,
		email: row.email,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		confirmedAt: row.confirmedAt?.toISOString() ?? null
	};
}

export async function listSubscribers(options: {
	search?: string;
	status?: 'pending' | 'active';
	limit?: number;
	offset?: number;
}): Promise<{ rows: SubscriberRow[]; total: number }> {
	const filters = [];
	if (options.status) filters.push(eq(subscribers.status, options.status));
	if (options.search) {
		const term = `%${options.search.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
		filters.push(like(subscribers.email, term));
	}
	const where = filters.length > 0 ? and(...filters) : undefined;

	const rows = await db
		.select()
		.from(subscribers)
		.where(where)
		.orderBy(desc(subscribers.createdAt))
		.limit(options.limit ?? 50)
		.offset(options.offset ?? 0);
	const total = await db
		.select({ n: sql<number>`count(*)` })
		.from(subscribers)
		.where(where);

	return { rows: rows.map(toRow), total: Number(total[0]?.n ?? 0) };
}

/** Walks the table by primary key, so memory and the rows each query reads stay bounded at any size. */
export async function* exportSubscriberPages(): AsyncGenerator<SubscriberRow[]> {
	const size = Math.max(1, Number(runtimeConfig().mail.exportPageSize) || 1000);
	let after = '';
	for (;;) {
		const rows = await db
			.select()
			.from(subscribers)
			.where(gt(subscribers.id, after))
			.orderBy(asc(subscribers.id))
			.limit(size);
		if (rows.length > 0) yield rows.map(toRow);
		if (rows.length < size) return;
		after = rows[rows.length - 1]!.id;
	}
}

export async function subscriberCounts(): Promise<{ active: number; pending: number }> {
	const rows = await db
		.select({ status: subscribers.status, n: sql<number>`count(*)` })
		.from(subscribers)
		.groupBy(subscribers.status);
	const count = (status: string) => Number(rows.find((r) => r.status === status)?.n ?? 0);
	return { active: count('active'), pending: count('pending') };
}

/** Counts only the open statuses, so the scan is bounded by the queue and not by sent history. */
export async function outboxCounts(): Promise<{ pending: number; failed: number }> {
	const rows = await db
		.select({ status: mailOutbox.status, n: sql<number>`count(*)` })
		.from(mailOutbox)
		.where(inArray(mailOutbox.status, ['pending', 'sending', 'failed']))
		.groupBy(mailOutbox.status);
	const count = (...statuses: string[]) =>
		rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + Number(r.n), 0);
	return { pending: count('pending', 'sending'), failed: count('failed') };
}

// #endregion

// #region outbox

// published adapters always qualify; listed ones only when an admin chose to email at that stage
async function emailableStatuses(): Promise<string[]> {
	return (await readStoredMail()).notifyOn === 'listed' ? ['listed', 'published'] : ['published'];
}

/**
 * Queues one row per active subscriber for a newly emailable public adapter; the unique index makes
 * a repeat call a no-op. Never throws: a queueing problem must not undo the publish.
 */
export async function enqueueAdapter(adapterId: string): Promise<void> {
	try {
		const adapter = (
			await db
				.select({ status: adapters.status, visibility: adapters.visibility })
				.from(adapters)
				.where(eq(adapters.id, adapterId))
				.limit(1)
		)[0];
		if (
			!adapter ||
			!(await emailableStatuses()).includes(adapter.status) ||
			adapter.visibility !== 'public'
		) {
			return;
		}

		const now = Date.now();
		await db.run(sql`
			INSERT INTO mail_outbox (id, subscriber_id, adapter_id, status, attempts, created_at, updated_at)
			SELECT lower(hex(randomblob(16))), id, ${adapterId}, 'pending', 0, ${now}, ${now}
			FROM subscribers WHERE status = 'active'
			ON CONFLICT (subscriber_id, adapter_id) DO NOTHING
		`);
	} catch (error) {
		console.warn('enqueueAdapter failed', adapterId, (error as Error)?.message);
	}
}

async function loadAdapter(adapterId: string) {
	return (
		await db
			.select({
				id: adapters.id,
				name: adapters.name,
				slug: adapters.slug,
				description: adapters.description,
				baseModel: adapters.baseModel,
				screenshots: adapters.screenshots,
				status: adapters.status,
				visibility: adapters.visibility
			})
			.from(adapters)
			.where(eq(adapters.id, adapterId))
			.limit(1)
	)[0];
}

type LoadedAdapter = NonNullable<Awaited<ReturnType<typeof loadAdapter>>>;

function firstScreenshot(raw: string | null): string | undefined {
	try {
		const list = JSON.parse(raw || '[]');
		return Array.isArray(list) && typeof list[0] === 'string' ? list[0] : undefined;
	} catch {
		return undefined;
	}
}

/** Mail clients block data URLs, so only an addressable image reaches the email. */
export function emailThumbnail(adapter: LoadedAdapter, origin: string): string | undefined {
	const first = firstScreenshot(adapter.screenshots);
	return first ? `${origin}${screenshotUrl(first)}` : undefined;
}

function summaryOf(text: string | null): string {
	const plain = (text ?? '').replace(/\s+/g, ' ').trim();
	return plain.length > 280 ? `${plain.slice(0, 277)}...` : plain;
}

export async function drainOutbox(env: MailEnv, limit = DRAIN_BATCH): Promise<DrainResult> {
	const result: DrainResult = { sent: 0, retried: 0, failed: 0, remaining: 0 };

	// the cron fires every minute, so the empty case has to cost one indexed row at most
	const open = await db
		.select({ id: mailOutbox.id })
		.from(mailOutbox)
		.where(inArray(mailOutbox.status, ['pending', 'sending']))
		.limit(1);
	if (open.length === 0) return result;

	if (!(await mailActive(env))) {
		result.remaining = (await outboxCounts()).pending;
		return result;
	}

	const now = Date.now();
	await db
		.update(mailOutbox)
		.set({ status: 'pending' })
		.where(
			and(
				eq(mailOutbox.status, 'sending'),
				lt(mailOutbox.updatedAt, new Date(now - STALE_CLAIM_MS))
			)
		);
	await db
		.delete(mailOutbox)
		.where(
			and(
				eq(mailOutbox.status, 'sent'),
				lt(mailOutbox.updatedAt, new Date(now - SENT_RETENTION_MS))
			)
		);

	const next = db
		.select({ id: mailOutbox.id })
		.from(mailOutbox)
		.where(eq(mailOutbox.status, 'pending'))
		.orderBy(asc(mailOutbox.updatedAt))
		.limit(limit);
	const claimed = await db
		.update(mailOutbox)
		.set({ status: 'sending', updatedAt: new Date(now) })
		.where(and(eq(mailOutbox.status, 'pending'), inArray(mailOutbox.id, next)))
		.returning();

	const origin = await siteOrigin();
	if (!origin) {
		// claimed rows go back so the next drain, once an admin has saved settings, picks them up
		if (claimed.length > 0) {
			await db
				.update(mailOutbox)
				.set({ status: 'pending' })
				.where(
					inArray(
						mailOutbox.id,
						claimed.map((r) => r.id)
					)
				);
		}
		result.remaining = (await outboxCounts()).pending;
		return result;
	}
	const name = await siteName();
	const emailable = await emailableStatuses();
	const loaded = new Map<string, LoadedAdapter | undefined>();

	for (const row of claimed) {
		const subscriber = (
			await db.select().from(subscribers).where(eq(subscribers.id, row.subscriberId)).limit(1)
		)[0];
		if (!loaded.has(row.adapterId)) loaded.set(row.adapterId, await loadAdapter(row.adapterId));
		const adapter = loaded.get(row.adapterId);

		if (
			!subscriber ||
			subscriber.status !== 'active' ||
			!adapter ||
			!emailable.includes(adapter.status) ||
			adapter.visibility !== 'public'
		) {
			await db.delete(mailOutbox).where(eq(mailOutbox.id, row.id));
			continue;
		}

		try {
			const links = await unsubscribeUrls(origin, subscriber.id);
			const message = renderAdapterEmail({
				siteName: name,
				name: adapter.name,
				baseModel: adapter.baseModel,
				summary: summaryOf(adapter.description),
				adapterUrl: `${origin}/adapters/${adapter.slug}`,
				thumbnailUrl: emailThumbnail(adapter, origin),
				unsubscribeUrl: links.page
			});
			await sendMail(env, {
				to: subscriber.email,
				...message,
				headers: {
					'List-Unsubscribe': `<${links.oneClick}>`,
					'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
				}
			});
			await db
				.update(mailOutbox)
				.set({ status: 'sent', attempts: row.attempts + 1, error: null, updatedAt: new Date() })
				.where(eq(mailOutbox.id, row.id));
			result.sent++;
		} catch (error) {
			const attempts = row.attempts + 1;
			const exhausted = attempts >= MAX_ATTEMPTS;
			await db
				.update(mailOutbox)
				.set({
					status: exhausted ? 'failed' : 'pending',
					attempts,
					error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
					updatedAt: new Date()
				})
				.where(eq(mailOutbox.id, row.id));
			if (exhausted) result.failed++;
			else result.retried++;
		}
	}

	result.remaining = (await outboxCounts()).pending;
	return result;
}

// #endregion
