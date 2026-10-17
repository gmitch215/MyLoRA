import { and, asc, desc, eq, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { ngrokTokens, type NgrokToken } from 'hub:db:schema';
import type { PublicNgrokToken } from '~/shared/types';
import { runtimeConfig } from './config';
import { decryptToken } from './crypto';

export function redactNgrokToken(row: NgrokToken): PublicNgrokToken {
	return {
		id: row.id,
		label: row.label,
		tokenLast4: row.tokenLast4,
		ownerId: row.ownerId,
		shared: row.shared,
		isDefault: row.isDefault,
		isActive: row.isActive,
		createdAt: new Date(row.createdAt).toISOString(),
		updatedAt: new Date(row.updatedAt).toISOString()
	};
}

/** The authtoken from the worker secret (NUXT_NGROK_AUTHTOKEN), or null when none is set. */
export function serverNgrokToken(): string | null {
	const token = runtimeConfig().ngrok?.authtoken;
	return typeof token === 'string' && token.trim() ? token.trim() : null;
}

async function usableRows(ownerId: string | null): Promise<NgrokToken[]> {
	const scope = ownerId
		? or(eq(ngrokTokens.shared, true), eq(ngrokTokens.ownerId, ownerId))
		: eq(ngrokTokens.shared, true);
	return db
		.select()
		.from(ngrokTokens)
		.where(and(eq(ngrokTokens.isActive, true), scope))
		.orderBy(desc(ngrokTokens.isDefault), asc(ngrokTokens.createdAt));
}

/** Throws a 400 unless the choice names something this user can run a serve with. */
export async function assertNgrokSource(source: string, ownerId: string): Promise<void> {
	if (source === 'auto' || source === 'machine') return;
	if (source === 'server') {
		if (!serverNgrokToken()) {
			throw createError({
				statusCode: 400,
				statusMessage: 'No server ngrok token is configured (NUXT_NGROK_AUTHTOKEN)'
			});
		}
		return;
	}
	if (!(await usableRows(ownerId)).some((r) => r.id === source)) {
		throw createError({ statusCode: 400, statusMessage: 'That ngrok token is not available' });
	}
}

/**
 * The authtoken a serve starts with, or null to leave ngrok on the machine's own sign in.
 * 'auto' picks the default stored token the owner may use, then the server secret, then nothing.
 */
export async function resolveNgrokToken(
	source: string | undefined,
	ownerId: string | null
): Promise<string | null> {
	const choice = source || 'auto';
	if (choice === 'machine') return null;
	if (choice === 'server') {
		const token = serverNgrokToken();
		if (!token) throw new Error('The server ngrok token is no longer configured');
		return token;
	}
	const rows = await usableRows(ownerId);
	if (choice === 'auto') {
		const pick =
			rows.find((r) => r.isDefault && r.ownerId === ownerId) ??
			rows.find((r) => r.isDefault) ??
			rows.find((r) => r.ownerId === ownerId) ??
			rows[0];
		return pick ? decryptToken(pick) : serverNgrokToken();
	}
	const picked = rows.find((r) => r.id === choice);
	if (!picked) throw new Error('The chosen ngrok token is no longer available');
	return decryptToken(picked);
}
