const API_BASE = 'https://api.cloudflare.com/client/v4';

// thrown by the stubbed single-get/delete endpoints until cloudflare ships them
export class CfUnsupported extends Error {
	constructor(op: string) {
		super(`Cloudflare ${op} endpoint is not available yet`);
		this.name = 'CfUnsupported';
	}
}

export function isMockCf(): boolean {
	const cfg = useRuntimeConfig();
	return cfg.mockCf === true && process.env.NODE_ENV !== 'production';
}

export function describeCfError(error: unknown): string {
	const seen = new Set<unknown>();
	let current: any = error;
	while (current && !seen.has(current)) {
		seen.add(current);
		if (Array.isArray(current?.errors) && current.errors.length) {
			// surface EVERY error cloudflare returned (with codes) so a failure is never ambiguous
			const all = current.errors
				.map((e: any) => (e?.message ? `${e.message}${e.code ? ` [${e.code}]` : ''}` : null))
				.filter(Boolean);
			if (all.length) return all.join('; ');
		}
		if (current?.message) return current.message;
		current = current?.cause;
	}
	return String(error);
}

// turn a raw cf error into actionable guidance for the common token-permission rejection. the REST
// call is correct - ACTION_NOT_AUTHORIZED means the token authenticates but lacks the finetune-create
// permission (or the account cannot create public finetunes), so the fix is on the token, not the code
export function explainCfError(error: unknown): string {
	const raw = describeCfError(error);
	// include the exact endpoint we hit (account id is fine; no token is ever in the url)
	const u = (error as any)?.url as string | undefined;
	const m = (error as any)?.method as string | undefined;
	const where = u ? ` (Request: ${m || 'GET'} ${u})` : '';
	if (
		/ACTION_NOT_AUTHORIZED|not authoriz|unauthoriz|permission|forbidden|authentication error/i.test(
			raw
		)
	) {
		return `${raw} - the Cloudflare API token is not authorized for this action. Create a token with "Workers AI: Edit" (and an account allowed to create finetunes), then update this account; a read-only token can list finetunes but cannot publish.${where}`;
	}
	return `${raw}${where}`;
}

// http status attached to a thrown cf error (if any)
export function cfErrorStatus(error: unknown): number | undefined {
	const s = (error as any)?.status;
	return typeof s === 'number' ? s : undefined;
}

// cloudflare auto-dedupes identical adapter configs and returns a conflict; that is not a real
// failure (the asset is already attached), so the publish flow treats it as success
export function isBenignCfError(error: unknown): boolean {
	if (cfErrorStatus(error) === 409) return true;
	const msg = describeCfError(error).toLowerCase();
	return /already exist|duplicat|dedup|conflict|same (file|config|adapter)/.test(msg);
}

// a dropped connection can surface after cloudflare already committed the asset; treat these as
// transient so the flow verifies the finetune before declaring failure
export function isTransientCfError(error: unknown): boolean {
	const status = cfErrorStatus(error);
	if (status && status >= 500) return true;
	const msg = describeCfError(error).toLowerCase();
	// "internal error; reference = ..." is cloudflare's own 5xx page (retryable); the rest are transport
	return /internal error|reference =|network connection|connection lost|connection reset|timed? ?out|fetch failed|terminated|socket|request failed/.test(
		msg
	);
}

async function cfFetch<T>(
	token: string,
	path: string,
	init: RequestInit & { raw?: BodyInit } = {}
): Promise<T> {
	// the url carries the account id but NOT the token (that's an Authorization header), so it is safe
	// to attach to errors for diagnostics
	const url = `${API_BASE}${path}`;
	const method = String(init.method || 'GET').toUpperCase();
	let res: Response;
	try {
		res = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				...(init.headers || {})
			}
		});
	} catch (e) {
		const err = new Error(`Cloudflare request failed: ${(e as Error)?.message ?? String(e)}`);
		(err as any).url = url;
		(err as any).method = method;
		throw err;
	}
	const text = await res.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	if (!res.ok || json?.success === false) {
		const err = new Error(describeCfError(json) || `Cloudflare error ${res.status}`);
		(err as any).status = res.status;
		(err as any).errors = json?.errors;
		(err as any).url = url;
		(err as any).method = method;
		throw err;
	}
	return (json?.result ?? json) as T;
}

export type FinetuneRecord = {
	id: string;
	name: string;
	model?: string;
	description?: string;
	public?: boolean;
	created_at?: string;
};

// verify a token works (used when registering an account)
export async function verifyToken(accountId: string, token: string): Promise<boolean> {
	if (isMockCf()) return true;
	await cfFetch(token, `/accounts/${accountId}/ai/finetunes`, { method: 'GET' });
	return true;
}

export type FinetunePermission = { canPublish: boolean | null; detail: string };

export async function checkFinetuneWritePermission(
	accountId: string,
	token: string
): Promise<FinetunePermission> {
	if (isMockCf()) {
		// a token marked read-only (test fixture) simulates a no-publish token
		const canPublish = !/readonly|read-only|noperm/i.test(token);
		return {
			canPublish,
			detail: canPublish
				? 'Token is valid and authorized for Workers AI.'
				: 'Token lacks Workers AI: Edit.'
		};
	}
	// 1) confirm the token authenticates + is active (a disabled/expired token can never publish)
	try {
		const v = await cfFetch<{ status?: string }>(token, `/user/tokens/verify`, { method: 'GET' });
		if (v?.status && v.status !== 'active')
			return { canPublish: false, detail: `Token is ${v.status} - re-create it.` };
	} catch (e) {
		const status = cfErrorStatus(e);
		if (status === 401 || status === 403)
			return { canPublish: false, detail: 'Token is invalid or expired - re-create it.' };
		// verify unreachable -> fall through to the finetune probe rather than blocking
	}
	// 2) probe the finetune-create authorization on THIS account
	try {
		await cfFetch(token, `/accounts/${accountId}/ai/finetunes`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});
		return { canPublish: true, detail: 'Token is valid and authorized for Workers AI.' };
	} catch (e) {
		const status = cfErrorStatus(e);
		const msg = describeCfError(e);
		if (status === 401)
			return { canPublish: false, detail: 'Token is invalid or expired - re-create it.' };
		if (
			status === 403 ||
			/ACTION_NOT_AUTHORIZED|not authoriz|unauthoriz|forbidden|permission/i.test(msg)
		)
			return {
				canPublish: false,
				detail: 'Token lacks Workers AI: Edit on this account (cannot create finetunes).'
			};
		// authorized (gateway let it through) - only the empty body was rejected, nothing created
		if (status === 400)
			return { canPublish: true, detail: 'Token is valid and authorized for Workers AI.' };
		return { canPublish: null, detail: msg };
	}
}

export async function createFinetune(
	accountId: string,
	token: string,
	body: { model: string; name: string; description?: string }
): Promise<FinetuneRecord> {
	if (isMockCf()) {
		return { id: `mock-${body.name}`, name: body.name, model: body.model };
	}
	// the official LoRA REST flow posts ONLY model/name/description; sending extra fields (e.g. `public`)
	// can trip an account-entitlement check and surface as ACTION_NOT_AUTHORIZED
	return cfFetch<FinetuneRecord>(token, `/accounts/${accountId}/ai/finetunes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: body.model, name: body.name, description: body.description })
	});
}

// stream an asset (config or weights) into the finetune-assets endpoint
export async function uploadFinetuneAsset(
	accountId: string,
	token: string,
	finetuneId: string,
	fileName: string,
	body: ReadableStream<Uint8Array> | Blob | ArrayBuffer | Uint8Array
): Promise<void> {
	if (isMockCf()) return;
	// normalize whatever the blob store handed us to real bytes, then send a fresh, explicitly-typed
	// Blob. wrapping a non-Blob object in `new Blob([obj])` can serialize to "[object Object]" and yield
	// a malformed multipart part, which cloudflare rejects with an opaque "internal error"
	const bytes =
		body instanceof Uint8Array
			? body
			: body instanceof ArrayBuffer
				? new Uint8Array(body)
				: body instanceof Blob
					? new Uint8Array(await body.arrayBuffer())
					: new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
	const type = fileName.endsWith('.json') ? 'application/json' : 'application/octet-stream';
	// a multipart body cannot be replayed, so rebuild the form per attempt
	const attempt = () => {
		const form = new FormData();
		form.set('file_name', fileName);
		form.set('file', new Blob([bytes], { type }), fileName);
		// NO trailing slash: the real API route is /finetune-assets (a trailing slash 404s with
		// "Route not found [1000]", despite the trailing slash shown in the docs' curl example)
		return cfFetch(token, `/accounts/${accountId}/ai/finetunes/${finetuneId}/finetune-assets`, {
			method: 'POST',
			body: form
		});
	};
	// cloudflare's asset endpoint occasionally 5xx's ("internal error; reference = ..."); retry a few
	// times with backoff before giving up, since those are almost always transient
	const MAX_ATTEMPTS = 3;
	for (let i = 1; i <= MAX_ATTEMPTS; i++) {
		try {
			await attempt();
			return;
		} catch (e) {
			// cloudflare dedupes identical configs; a conflict means the asset is already attached
			if (isBenignCfError(e)) return;
			if (isTransientCfError(e) && i < MAX_ATTEMPTS) {
				await new Promise((r) => setTimeout(r, 800 * i));
				continue;
			}
			throw e;
		}
	}
}

// deterministic fixture for the migration tests: an account id starting with 16 'a's reports
// finetunes (the rest stays unique per run so the unique account_id index is not violated)
function mockFinetunes(accountId: string): FinetuneRecord[] {
	if (accountId.startsWith('aaaaaaaaaaaaaaaa')) {
		return [
			{
				id: 'mock-ft-1',
				name: 'migrated-one',
				model: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
				public: false
			},
			{
				id: 'mock-ft-2',
				name: 'migrated-two',
				model: '@cf/google/gemma-7b-it-lora',
				public: true
			}
		];
	}
	return [];
}

export async function listFinetunes(accountId: string, token: string): Promise<FinetuneRecord[]> {
	if (isMockCf()) return mockFinetunes(accountId);
	const res = await cfFetch<FinetuneRecord[]>(token, `/accounts/${accountId}/ai/finetunes`, {
		method: 'GET'
	});
	return Array.isArray(res) ? res : [];
}

// stubbed: cloudflare has not shipped a documented single-get yet
export async function getFinetune(
	accountId: string,
	token: string,
	finetuneId: string,
	enabled: boolean
): Promise<FinetuneRecord> {
	if (isMockCf()) return { id: finetuneId, name: finetuneId };
	if (!enabled) throw new CfUnsupported('GET finetune');
	return cfFetch<FinetuneRecord>(token, `/accounts/${accountId}/ai/finetunes/${finetuneId}`, {
		method: 'GET'
	});
}

// stubbed: cloudflare has not shipped a documented delete yet
export async function deleteFinetune(
	accountId: string,
	token: string,
	finetuneId: string,
	enabled: boolean
): Promise<void> {
	if (isMockCf()) return;
	if (!enabled) throw new CfUnsupported('DELETE finetune');
	await cfFetch(token, `/accounts/${accountId}/ai/finetunes/${finetuneId}`, { method: 'DELETE' });
}

// always overwrite the uploaded config's model_type from our own metadata
export function canonicalizeAdapterConfig(raw: string, modelType: ModelType): { json: string } {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw createError({ statusCode: 400, statusMessage: 'adapter_config.json is not valid JSON' });
	}
	parsed.model_type = modelType;
	return { json: JSON.stringify(parsed, null, 2) };
}

// read the rank (r) from an adapter config for validation
export function readRankFromConfig(raw: string): number | null {
	try {
		const parsed = JSON.parse(raw);
		const r = parsed?.r ?? parsed?.lora_rank ?? parsed?.rank;
		return typeof r === 'number' ? r : null;
	} catch {
		return null;
	}
}
