import { and, eq, lt } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, cloudflareAccounts } from 'hub:db:schema';
import { kv } from 'hub:kv';
import { invalidateAdapterLists } from './cache';
import { listFinetunes } from './cloudflare';
import { decryptToken } from './crypto';

const GRACE_MS = 90_000;
const GIVE_UP_MS = 15 * 60_000;

function updatedMs(v: unknown): number {
	return v instanceof Date ? v.getTime() : Number(v) || 0;
}

async function markDone(id: string, finetuneName: string) {
	await db
		.update(adapters)
		.set({ status: 'published', finetuneName, statusMessage: null, updatedAt: new Date() })
		.where(eq(adapters.id, id));
	try {
		await kv.set(`mylora:push:${id}`, { phase: 'done', progress: 100, attempt: 1, ts: Date.now() });
	} catch {
		// best-effort job marker; the d1 status is authoritative
	}
}

async function markFailed(id: string, message: string) {
	await db
		.update(adapters)
		.set({ status: 'failed', statusMessage: message, updatedAt: new Date() })
		.where(eq(adapters.id, id));
	try {
		await kv.set(`mylora:push:${id}`, {
			phase: 'error',
			progress: 0,
			attempt: 1,
			error: message,
			ts: Date.now()
		});
	} catch {
		// best-effort
	}
}

export async function reconcileStuckPublishes(): Promise<void> {
	const now = Date.now();
	let stuck: (typeof adapters.$inferSelect)[];
	try {
		stuck = await db
			.select()
			.from(adapters)
			.where(and(eq(adapters.status, 'pushing'), lt(adapters.updatedAt, new Date(now - GRACE_MS))))
			.limit(20);
	} catch (e) {
		console.warn('reconcile publishes query failed', (e as Error)?.message);
		return;
	}
	if (!stuck.length) return;

	let changed = false;
	for (const a of stuck) {
		const aged = updatedMs(a.updatedAt) < now - GIVE_UP_MS;
		try {
			// no finetune was ever created; nothing to verify -> only fail once it is clearly hung
			if (!a.finetuneId || !a.accountId) {
				if (aged) {
					await markFailed(a.id, 'Publish did not complete');
					changed = true;
				}
				continue;
			}
			const acc = (
				await db
					.select()
					.from(cloudflareAccounts)
					.where(eq(cloudflareAccounts.id, a.accountId))
					.limit(1)
			)[0];
			if (!acc) continue;
			const token = await decryptToken(acc);
			const list = await listFinetunes(acc.accountId, token);
			const found = list.some((f) => f.id === a.finetuneId || f.name === a.slug);
			if (found) {
				await markDone(a.id, a.slug || a.finetuneId);
				changed = true;
			} else if (aged) {
				await markFailed(a.id, 'Finetune not found on Cloudflare after publish');
				changed = true;
			}
		} catch (e) {
			console.warn('reconcile publish failed', a.id, (e as Error)?.message);
		}
	}
	if (changed) await invalidateAdapterLists();
}
