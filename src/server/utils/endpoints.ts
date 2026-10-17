import { count, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, inferenceEndpoints, type InferenceEndpoint } from 'hub:db:schema';
import type { PublicEndpoint, ServeConfig } from '~/shared/types';
import type { SessionUser } from './auth';
import { decryptSecret, encryptSecret } from './crypto';
import { endpointBase, parseEndpointUrl } from './endpoint-guard';
import { siteOrigin } from './subscribers';

function parseServe(raw: string | null): ServeConfig | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as ServeConfig;
	} catch {
		return null;
	}
}

// every field a client may see; the key and the launch secrets never leave the server
export function redactEndpoint(
	row: InferenceEndpoint,
	adapterCount = 0,
	opts: { withLog?: boolean } = {}
): PublicEndpoint {
	const iso = (d: Date | number | null | undefined) => (d ? new Date(d).toISOString() : null);
	return {
		id: row.id,
		label: row.label,
		ownerId: row.ownerId,
		shared: row.shared,
		source: row.source,
		baseUrl: row.baseUrl,
		defaultModel: row.defaultModel,
		keyLast4: row.keyLast4,
		isActive: row.isActive,
		health: row.health,
		lastDiagnosis: row.lastDiagnosis,
		lastCheckedAt: iso(row.lastCheckedAt),
		machineId: row.machineId,
		serveStatus: row.serveStatus,
		serve: parseServe(row.serveConfig),
		logTail: opts.withLog ? row.logTail : null,
		adapterCount,
		startedAt: iso(row.startedAt),
		stoppedAt: iso(row.stoppedAt),
		createdAt: iso(row.createdAt)!,
		updatedAt: iso(row.updatedAt)!
	};
}

export async function adapterCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({ id: adapters.endpointId, n: count() })
		.from(adapters)
		.groupBy(adapters.endpointId);
	return new Map(rows.filter((r) => r.id).map((r) => [r.id as string, Number(r.n)]));
}

export async function encryptEndpointKey(key: string) {
	const enc = await encryptSecret(key);
	return {
		keyCipher: enc.cipher,
		keyIv: enc.iv,
		keyDekCipher: enc.dekCipher,
		keyDekIv: enc.dekIv,
		keyLast4: key.slice(-4)
	};
}

export async function decryptEndpointKey(row: InferenceEndpoint): Promise<string | null> {
	if (!row.keyCipher || !row.keyIv || !row.keyDekCipher || !row.keyDekIv) return null;
	return decryptSecret({
		cipher: row.keyCipher,
		iv: row.keyIv,
		dekCipher: row.keyDekCipher,
		dekIv: row.keyDekIv
	});
}

/** Validates a user-supplied url and returns it normalized, or throws a 400 that says why. */
export async function validatedBaseUrl(raw: string): Promise<string> {
	let host: string | null = null;
	try {
		host = new URL(await siteOrigin()).hostname;
	} catch {
		// no origin saved yet
	}
	const parsed = parseEndpointUrl(raw, host);
	if (!parsed.ok) throw createError({ statusCode: 400, statusMessage: parsed.reason });
	return endpointBase(parsed.url);
}

export async function loadEndpoint(id: string): Promise<InferenceEndpoint | null> {
	return (
		(await db.select().from(inferenceEndpoints).where(eq(inferenceEndpoints.id, id)).limit(1))[0] ??
		null
	);
}

/**
 * The endpoint a request may run against, with its key. A personal endpoint answers only its
 * owner (administrators included only when they own it), and a serve job must be running.
 */
export async function loadUsableEndpoint(
	id: string,
	user: SessionUser | null
): Promise<{ row: InferenceEndpoint; apiKey: string | null }> {
	const row = await loadEndpoint(id);
	if (!row || !row.isActive) {
		throw createError({ statusCode: 409, statusMessage: 'This adapter has no active endpoint' });
	}
	if (!row.shared && row.ownerId !== user?.id) {
		throw createError({
			statusCode: 403,
			statusMessage: 'This adapter runs on a private endpoint'
		});
	}
	if (row.source === 'vllm' && row.serveStatus !== 'ready') {
		throw createError({ statusCode: 503, statusMessage: 'The endpoint is not running right now' });
	}
	if (!row.baseUrl) {
		throw createError({ statusCode: 503, statusMessage: 'The endpoint has no URL yet' });
	}
	return { row, apiKey: await decryptEndpointKey(row) };
}
