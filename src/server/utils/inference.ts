import { desc, eq } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { db } from 'hub:db';
import { adapters, cloudflareAccounts } from 'hub:db:schema';
import { describeCfError, isMockCf } from './cloudflare';
import { decryptToken } from './crypto';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type InferTarget = { baseModel: string; lora?: string; accountId?: string | null };

type ResolvedTarget = {
	baseModel: string;
	lora: string;
	cfAccountId: string;
	token: string | null;
	isDefaultAccount: boolean;
};

function aiBinding(event: H3Event): any {
	const fromCtx = (event.context as any)?.cloudflare?.env?.AI;
	if (fromCtx) return fromCtx;
	return (process.env as any).AI ?? null;
}

export function adapterTarget(adapter: Adapter): InferTarget {
	return {
		baseModel: adapter.baseModel,
		lora: adapter.finetuneName || adapter.finetuneId || '',
		accountId: adapter.accountId
	};
}

async function resolveTarget(input: InferTarget): Promise<ResolvedTarget> {
	const cfg = useRuntimeConfig();
	const lora = input.lora || '';

	if (!input.accountId) {
		// no explicit account: prefer the configured global token over REST (works in local dev too);
		// only fall back to the native binding when no global token is set
		const globalToken = cfg.cf?.apiToken || '';
		const globalAccount = cfg.cf?.accountId || '';
		if (globalToken && globalAccount) {
			return {
				baseModel: input.baseModel,
				lora,
				cfAccountId: globalAccount,
				token: globalToken,
				isDefaultAccount: false
			};
		}
		// no global token: fall back to a registered active account (prefer the default) via REST so
		// base-model runs work without the native binding (which can't run under local wrangler dev)
		const fallback = (
			await db
				.select()
				.from(cloudflareAccounts)
				.where(eq(cloudflareAccounts.isActive, true))
				.orderBy(desc(cloudflareAccounts.isDefault))
				.limit(1)
		)[0];
		if (fallback) {
			return {
				baseModel: input.baseModel,
				lora,
				cfAccountId: fallback.accountId,
				token: await decryptToken(fallback),
				isDefaultAccount: false
			};
		}
		// last resort: the native binding (prod, or local with experimental_remote)
		return {
			baseModel: input.baseModel,
			lora,
			cfAccountId: globalAccount,
			token: null,
			isDefaultAccount: true
		};
	}

	// an explicit registered account always runs via REST with its own decrypted token
	const rows = await db
		.select()
		.from(cloudflareAccounts)
		.where(eq(cloudflareAccounts.id, input.accountId))
		.limit(1);
	const account = rows[0];
	if (!account) throw createError({ statusCode: 409, statusMessage: 'Hosting account missing' });

	return {
		baseModel: input.baseModel,
		lora,
		cfAccountId: account.accountId,
		token: await decryptToken(account),
		isDefaultAccount: false
	};
}

const API_BASE = 'https://api.cloudflare.com/client/v4';

// the lora option is omitted entirely for base-only runs
function runBody(
	target: ResolvedTarget,
	messages: ChatMessage[],
	stream: boolean,
	maxTokens?: number
) {
	const body: Record<string, unknown> = { messages, raw: true };
	if (target.lora) body.lora = target.lora;
	if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;
	if (stream) body.stream = true;
	return body;
}

function mockText(target: InferTarget, messages: ChatMessage[]): string {
	const last = messages[messages.length - 1]?.content ?? '';
	const tag = target.lora ? `lora:${target.lora}` : `base:${target.baseModel}`;
	return `[mock ${tag}] ${last}`.slice(0, 400);
}

async function runRest(
	target: ResolvedTarget,
	messages: ChatMessage[],
	maxTokens?: number
): Promise<{ response: string; outputTokens: number }> {
	const res = await fetch(`${API_BASE}/accounts/${target.cfAccountId}/ai/run/${target.baseModel}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${target.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(runBody(target, messages, false, maxTokens))
	});
	const json: any = await res.json().catch(() => null);
	if (!res.ok || json?.success === false) {
		const err = new Error(describeCfError(json) || `inference failed (${res.status})`);
		(err as any).status = res.status;
		throw err;
	}
	const result = json?.result ?? json;
	const response = result?.response ?? '';
	const outputTokens = result?.usage?.completion_tokens ?? estimateTokens(response);
	return { response, outputTokens };
}

// non-streaming inference for a target (adapter via adapterTarget(), or a bare base model)
export async function runInference(
	event: H3Event,
	target: InferTarget,
	messages: ChatMessage[],
	opts: { maxTokens?: number } = {}
): Promise<InferenceResult> {
	if (isMockCf()) {
		const response = mockText(target, messages);
		return { response, outputTokens: estimateTokens(response) };
	}

	const resolved = await resolveTarget(target);
	if (resolved.isDefaultAccount) {
		const ai = aiBinding(event);
		if (!ai) throw createError({ statusCode: 503, statusMessage: 'AI binding unavailable' });
		const out = await ai.run(
			resolved.baseModel,
			runBody(resolved, messages, false, opts.maxTokens)
		);
		const response = out?.response ?? '';
		const outputTokens = out?.usage?.completion_tokens ?? estimateTokens(response);
		return { response, outputTokens };
	}
	return runRest(resolved, messages, opts.maxTokens);
}

// streaming inference for a target; returns a ReadableStream of SSE bytes
export async function runInferenceStream(
	event: H3Event,
	target: InferTarget,
	messages: ChatMessage[],
	opts: { maxTokens?: number } = {}
): Promise<ReadableStream<Uint8Array>> {
	if (isMockCf()) {
		const text = mockText(target, messages);
		// emit several frames (one per word) so the streaming render path is exercised, not one blob
		const words = text.split(' ');
		return new ReadableStream({
			start(controller) {
				const enc = new TextEncoder();
				words.forEach((w, i) => {
					const chunk = i === 0 ? w : ` ${w}`;
					controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: chunk })}\n\n`));
				});
				controller.enqueue(enc.encode('data: [DONE]\n\n'));
				controller.close();
			}
		});
	}

	const resolved = await resolveTarget(target);
	if (resolved.isDefaultAccount) {
		const ai = aiBinding(event);
		if (!ai) throw createError({ statusCode: 503, statusMessage: 'AI binding unavailable' });
		return ai.run(resolved.baseModel, runBody(resolved, messages, true, opts.maxTokens));
	}

	const res = await fetch(
		`${API_BASE}/accounts/${resolved.cfAccountId}/ai/run/${resolved.baseModel}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${resolved.token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(runBody(resolved, messages, true, opts.maxTokens))
		}
	);
	if (!res.ok || !res.body) {
		const json: any = await res.json().catch(() => null);
		throw new Error(describeCfError(json) || `inference failed (${res.status})`);
	}
	return res.body;
}

export const SUMMARY_MODEL = '@cf/facebook/bart-large-cnn';
export async function runSummary(
	event: H3Event,
	text: string,
	opts: { maxLength?: number } = {}
): Promise<string> {
	const input = (text || '').slice(0, 8000).trim();
	if (!input) return '';
	if (isMockCf()) {
		// deterministic stand-in so the compaction path is exercised without a live model
		return `[summary] ${input.replace(/\s+/g, ' ').slice(0, 160)}`.trim();
	}

	const resolved = await resolveTarget({ baseModel: SUMMARY_MODEL });
	const payload: Record<string, unknown> = { input_text: input };
	if (opts.maxLength && opts.maxLength > 0) payload.max_length = opts.maxLength;

	if (resolved.isDefaultAccount) {
		const ai = aiBinding(event);
		if (!ai) throw createError({ statusCode: 503, statusMessage: 'AI binding unavailable' });
		const out = await ai.run(SUMMARY_MODEL, payload);
		return out?.summary ?? '';
	}

	const res = await fetch(`${API_BASE}/accounts/${resolved.cfAccountId}/ai/run/${SUMMARY_MODEL}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${resolved.token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	const json: any = await res.json().catch(() => null);
	if (!res.ok || json?.success === false) {
		const err = new Error(describeCfError(json) || `summarize failed (${res.status})`);
		(err as any).status = res.status;
		throw err;
	}
	const result = json?.result ?? json;
	return result?.summary ?? '';
}

// load an adapter row mapped to the Adapter shape used by inference
export async function loadAdapterById(id: string): Promise<Adapter | null> {
	const rows = await db.select().from(adapters).where(eq(adapters.id, id)).limit(1);
	return (rows[0] as unknown as Adapter) ?? null;
}
