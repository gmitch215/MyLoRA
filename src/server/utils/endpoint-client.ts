import type { EndpointHealth } from '~/shared/types';
import { isMockCf } from './cloudflare';
import { assertPublicHost, parseEndpointUrl } from './endpoint-guard';
import type { ChatMessage } from './inference';

export type EndpointCall = {
	baseUrl: string;
	apiKey: string | null;
	model: string;
};

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_STREAM_BYTES = 4 * 1024 * 1024;

export class EndpointError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'EndpointError';
	}
}

// never let a key echoed back by a misbehaving server reach logs, errors or the UI
function scrub(text: string, key: string | null): string {
	let out = text;
	if (key && key.length >= 8) out = out.split(key).join('[key]');
	return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [key]');
}

async function checkedUrl(baseUrl: string, path: string): Promise<string> {
	const parsed = parseEndpointUrl(baseUrl);
	if (!parsed.ok) throw new EndpointError(parsed.reason);
	try {
		await assertPublicHost(parsed.url.hostname.toLowerCase());
	} catch (error) {
		throw new EndpointError((error as Error).message);
	}
	return `${parsed.url.origin}${parsed.url.pathname.replace(/\/+$/, '')}${path}`;
}

async function send(
	call: EndpointCall,
	path: string,
	init: { method: 'GET' | 'POST'; body?: unknown; stream?: boolean }
): Promise<Response> {
	const url = await checkedUrl(call.baseUrl, path);
	const headers: Record<string, string> = {
		accept: init.stream ? 'text/event-stream' : 'application/json'
	};
	if (init.body !== undefined) headers['content-type'] = 'application/json';
	if (call.apiKey) headers.authorization = `Bearer ${call.apiKey}`;

	let res: Response;
	try {
		res = await fetch(url, {
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			// a redirect could point anywhere, including inside, so it is an error instead
			redirect: 'manual',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		throw new EndpointError(
			scrub(`Could not reach the endpoint: ${(error as Error).message}`, call.apiKey)
		);
	}
	if (res.status >= 300 && res.status < 400) {
		throw new EndpointError(
			'The endpoint redirected the request, which is not followed',
			res.status
		);
	}
	if (!res.ok) {
		const detail = scrub((await readCapped(res, 2048).catch(() => '')).slice(0, 300), call.apiKey);
		throw new EndpointError(
			`The endpoint returned ${res.status}${detail ? `: ${detail}` : ''}`,
			res.status
		);
	}
	return res;
}

async function readCapped(res: Response, max: number): Promise<string> {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	let bytes = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > max) {
			await reader.cancel().catch(() => {});
			throw new EndpointError('The endpoint response was too large');
		}
		text += decoder.decode(value, { stream: true });
	}
	return text + decoder.decode();
}

function chatBody(
	call: EndpointCall,
	messages: ChatMessage[],
	stream: boolean,
	maxTokens?: number
) {
	const body: Record<string, unknown> = { model: call.model, messages, stream };
	if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;
	return body;
}

function mockHost(call: EndpointCall): string {
	try {
		return new URL(call.baseUrl).hostname;
	} catch {
		return '';
	}
}

function mockReply(call: EndpointCall, messages: ChatMessage[]): string {
	// vllm chat templates reject a conversation that does not alternate, so the mock does too
	assertAlternatingRoles(messages);
	const host = mockHost(call);
	if (host.startsWith('mock-auth')) throw new EndpointError('The endpoint returned 401', 401);
	if (host.startsWith('mock-down')) throw new EndpointError('Could not reach the endpoint');
	const last = messages[messages.length - 1]?.content ?? '';
	return `[mock endpoint:${call.model}] ${last}`.slice(0, 400);
}

export async function endpointChat(
	call: EndpointCall,
	messages: ChatMessage[],
	opts: { maxTokens?: number } = {}
): Promise<{ response: string; outputTokens: number }> {
	if (isMockCf()) {
		const response = mockReply(call, messages);
		return { response, outputTokens: Math.ceil(response.length / 4) };
	}
	const res = await send(call, '/chat/completions', {
		method: 'POST',
		body: chatBody(call, messages, false, opts.maxTokens)
	});
	let json: any;
	try {
		json = JSON.parse(await readCapped(res, MAX_BODY_BYTES));
	} catch (error) {
		if (error instanceof EndpointError) throw error;
		throw new EndpointError('The endpoint returned something that is not JSON');
	}
	const response = json?.choices?.[0]?.message?.content;
	if (typeof response !== 'string') {
		throw new EndpointError('The endpoint response had no message content');
	}
	return {
		response,
		outputTokens: Number(json?.usage?.completion_tokens) || Math.ceil(response.length / 4)
	};
}

/**
 * Streams a chat completion as the `data: {"response": "..."}` frames the Workers AI path emits, so
 * the widget and playground read both the same way.
 */
export async function endpointChatStream(
	call: EndpointCall,
	messages: ChatMessage[],
	opts: { maxTokens?: number } = {}
): Promise<ReadableStream<Uint8Array>> {
	const enc = new TextEncoder();
	if (isMockCf()) {
		const words = mockReply(call, messages).split(' ');
		return new ReadableStream({
			start(controller) {
				words.forEach((w, i) => {
					const chunk = i === 0 ? w : ` ${w}`;
					controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: chunk })}\n\n`));
				});
				controller.enqueue(enc.encode('data: [DONE]\n\n'));
				controller.close();
			}
		});
	}

	const res = await send(call, '/chat/completions', {
		method: 'POST',
		body: chatBody(call, messages, true, opts.maxTokens),
		stream: true
	});
	if (!res.body) throw new EndpointError('The endpoint sent no body');

	const dec = new TextDecoder();
	let buffer = '';
	let total = 0;
	return res.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				total += chunk.byteLength;
				if (total > MAX_STREAM_BYTES) {
					controller.error(new EndpointError('The endpoint response was too large'));
					return;
				}
				buffer += dec.decode(chunk, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const raw of lines) {
					const line = raw.trim();
					if (!line.startsWith('data:')) continue;
					const payload = line.slice(5).trim();
					if (payload === '[DONE]') {
						controller.enqueue(enc.encode('data: [DONE]\n\n'));
						continue;
					}
					try {
						const text = JSON.parse(payload)?.choices?.[0]?.delta?.content;
						if (typeof text === 'string' && text) {
							controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: text })}\n\n`));
						}
					} catch {
						// a keep-alive or non-json frame
					}
				}
			}
		})
	);
}

export type EndpointProbe = {
	health: EndpointHealth;
	message: string;
	models: string[];
};

/** GET /models: proves the url, the key and (when asked) that a model name is served. */
export async function probeEndpoint(call: Omit<EndpointCall, 'model'>): Promise<EndpointProbe> {
	if (isMockCf()) {
		const host = mockHost({ ...call, model: '' });
		if (host.startsWith('mock-auth')) {
			return { health: 'auth_failed', message: 'The endpoint rejected the key', models: [] };
		}
		if (host.startsWith('mock-down')) {
			return { health: 'unreachable', message: 'Could not reach the endpoint', models: [] };
		}
		return { health: 'ok', message: 'Reachable', models: ['mock-base', 'mock-lora'] };
	}
	try {
		const res = await send({ ...call, model: '' }, '/models', { method: 'GET' });
		const json = JSON.parse(await readCapped(res, MAX_BODY_BYTES));
		const models = Array.isArray(json?.data)
			? json.data.map((m: { id?: string }) => m?.id).filter((id: unknown) => typeof id === 'string')
			: [];
		return { health: 'ok', message: 'Reachable', models };
	} catch (error) {
		if (error instanceof EndpointError) {
			if (error.status === 401 || error.status === 403) {
				return { health: 'auth_failed', message: 'The endpoint rejected the key', models: [] };
			}
			return { health: 'unreachable', message: error.message, models: [] };
		}
		return {
			health: 'unreachable',
			message: 'The endpoint returned something unexpected',
			models: []
		};
	}
}
