import type { APIRequestContext } from '@playwright/test';
import { loginViaApi } from './auth';
import { ensureDefaultAccount } from './cf';

let seq = 0;

export type AdapterSeed = {
	name?: string;
	slug?: string;
	description?: string;
	baseModel?: string;
	modelType?: 'mistral' | 'gemma' | 'llama' | 'qwen';
	rank?: number;
	visibility?: 'public' | 'unlisted' | 'private';
	tags?: string[];
};

// create a draft adapter via the api (logs in as admin unless a session is already set)
export async function createAdapter(request: APIRequestContext, overrides: AdapterSeed = {}) {
	await loginViaApi(request);
	const n = `tmp-adapter-${Date.now()}-${seq++}`;
	const payload = {
		name: overrides.name ?? n,
		slug: overrides.slug ?? n,
		description: overrides.description ?? 'a test adapter',
		baseModel: overrides.baseModel ?? '@cf/mistral/mistral-7b-instruct-v0.2-lora',
		modelType: overrides.modelType ?? 'mistral',
		rank: overrides.rank ?? 8,
		tags: overrides.tags ?? ['test'],
		examples: [],
		visibility: overrides.visibility ?? 'public'
	};
	const res = await request.post('/api/adapters/create', { data: payload });
	if (!res.ok()) throw new Error(`create adapter failed: ${res.status()} ${await res.text()}`);
	return (await res.json()) as { id: string; slug: string };
}

// upload a valid config + weights so the adapter becomes 'listed'
export async function uploadAssets(request: APIRequestContext, id: string, rank = 8) {
	const config = JSON.stringify({ r: rank, lora_alpha: 16, model_type: 'mistral' });
	const cfgRes = await request.post(`/api/adapters/${id}/upload`, {
		multipart: {
			asset: 'config',
			file: {
				name: 'adapter_config.json',
				mimeType: 'application/json',
				buffer: Buffer.from(config)
			}
		}
	});
	if (!cfgRes.ok())
		throw new Error(`config upload failed: ${cfgRes.status()} ${await cfgRes.text()}`);
	const weights = Buffer.from('fake-safetensors-bytes');
	const wRes = await request.post(`/api/adapters/${id}/upload`, {
		multipart: {
			asset: 'weights',
			file: {
				name: 'adapter_model.safetensors',
				mimeType: 'application/octet-stream',
				buffer: weights
			}
		}
	});
	if (!wRes.ok()) throw new Error(`weights upload failed: ${wRes.status()} ${await wRes.text()}`);
	return wRes.json();
}

// publish (mock cloudflare in test env makes this resolve to 'published' quickly)
export async function publishAdapter(request: APIRequestContext, id: string) {
	// publish needs a host account; ensure a shared default exists
	await ensureDefaultAccount(request);
	const res = await request.post(`/api/adapters/${id}/publish`);
	if (!res.ok()) throw new Error(`publish failed: ${res.status()} ${await res.text()}`);
	return res.json();
}

export async function statusOf(request: APIRequestContext, id: string) {
	const res = await request.get(`/api/adapters/${id}/status`);
	return res.json();
}

export async function deleteAdapter(request: APIRequestContext, id: string) {
	await loginViaApi(request);
	return request.delete(`/api/adapters/remove?id=${id}`);
}
