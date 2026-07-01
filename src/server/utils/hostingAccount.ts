import { and, asc, eq, lt, or } from 'drizzle-orm';
import { db } from 'hub:db';
import type { CloudflareAccount } from 'hub:db:schema';
import { cloudflareAccounts } from 'hub:db:schema';

// max adapters a single cloudflare account will host (the finetune slot budget)
export const ACCOUNT_CAP = 100;

// an account is usable by a user when it is active and either owned by them or shared
function usableBy(a: CloudflareAccount, userId: string): boolean {
	return a.isActive && (a.ownerId === userId || a.shared);
}

export async function resolveHostingAccount(opts: {
	userId: string;
	adapterAccountId?: string | null;
	requestedAccountId?: string | null;
}): Promise<{ account: CloudflareAccount | null; error?: string }> {
	const byId = async (id: string) =>
		(await db.select().from(cloudflareAccounts).where(eq(cloudflareAccounts.id, id)).limit(1))[0];

	// explicit choice: validate hard, never fall back to a different account
	if (opts.requestedAccountId) {
		const a = await byId(opts.requestedAccountId);
		if (!a || !usableBy(a, opts.userId))
			return { account: null, error: 'The selected Cloudflare account is not available to you.' };
		if (a.adapterCount >= ACCOUNT_CAP)
			return { account: null, error: 'The selected Cloudflare account is at its adapter cap.' };
		return { account: a };
	}

	// the account this adapter was previously pinned to (if still usable)
	if (opts.adapterAccountId) {
		const a = await byId(opts.adapterAccountId);
		if (a && usableBy(a, opts.userId) && a.adapterCount < ACCOUNT_CAP) return { account: a };
	}

	// the default account
	const def = (
		await db
			.select()
			.from(cloudflareAccounts)
			.where(and(eq(cloudflareAccounts.isActive, true), eq(cloudflareAccounts.isDefault, true)))
			.limit(1)
	)[0];
	if (def && usableBy(def, opts.userId) && def.adapterCount < ACCOUNT_CAP) return { account: def };

	// the user's own account with a free slot, then any shared account with a free slot
	const fallback = (
		await db
			.select()
			.from(cloudflareAccounts)
			.where(
				and(
					eq(cloudflareAccounts.isActive, true),
					or(eq(cloudflareAccounts.ownerId, opts.userId), eq(cloudflareAccounts.shared, true)),
					lt(cloudflareAccounts.adapterCount, ACCOUNT_CAP)
				)
			)
			.orderBy(asc(cloudflareAccounts.adapterCount))
			.limit(1)
	)[0];
	if (fallback) return { account: fallback };

	return { account: null, error: 'No Cloudflare account is available to host this adapter.' };
}
