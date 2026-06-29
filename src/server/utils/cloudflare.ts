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
			const e = current.errors[0];
			return e?.message ? `${e.message}${e.code ? ` [${e.code}]` : ''}` : String(current);
		}
		if (current?.message) return current.message;
		current = current?.cause;
	}
	return String(error);
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
	return /network connection|connection lost|connection reset|timed? ?out|fetch failed|terminated|socket/.test(
		msg
	);
}

async function cfFetch<T>(
	token: string,
	path: string,
	init: RequestInit & { raw?: BodyInit } = {}
): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			...(init.headers || {})
		}
	});
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

export async function createFinetune(
	accountId: string,
	token: string,
	body: { model: string; name: string; description?: string; public?: boolean }
): Promise<FinetuneRecord> {
	if (isMockCf()) {
		return { id: `mock-${body.name}`, name: body.name, model: body.model, public: body.public };
	}
	return cfFetch<FinetuneRecord>(token, `/accounts/${accountId}/ai/finetunes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
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
	const form = new FormData();
	form.set('file_name', fileName);
	const blob = body instanceof Blob ? body : new Blob([body as BlobPart]);
	form.set('file', blob, fileName);
	try {
		await cfFetch(token, `/accounts/${accountId}/ai/finetunes/${finetuneId}/finetune-assets`, {
			method: 'POST',
			body: form
		});
	} catch (e) {
		// cloudflare dedupes identical configs; a conflict means the asset is already attached
		if (isBenignCfError(e)) return;
		throw e;
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
