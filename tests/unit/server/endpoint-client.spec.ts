import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));

let client: typeof import('../../../src/server/utils/endpoint-client');
let guard: typeof import('../../../src/server/utils/endpoint-guard');

beforeAll(async () => {
	client = await import('../../../src/server/utils/endpoint-client');
	guard = await import('../../../src/server/utils/endpoint-guard');
});

const CALL = {
	baseUrl: 'https://vllm.example.com/v1',
	apiKey: 'sk-secret-key-123456',
	model: 'my-lora'
};
const MESSAGES = [{ role: 'user' as const, content: 'hi' }];

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

// DoH answers a public address; everything else goes to the handler under test
function stubFetch(handler: Handler, dns: string[] = ['93.184.216.34']) {
	const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
		if (url.startsWith('https://cloudflare-dns.com/')) {
			const type = url.includes('type=AAAA') ? 28 : 1;
			const data = type === 1 ? dns : [];
			return new Response(JSON.stringify({ Answer: data.map((d) => ({ type, data: d })) }), {
				headers: { 'content-type': 'application/dns-json' }
			});
		}
		return handler(url, init);
	});
	vi.stubGlobal('fetch', fn);
	vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));
	return fn;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function sse(frames: string[]): Response {
	return new Response(frames.map((f) => `${f}\n\n`).join(''), {
		headers: { 'content-type': 'text/event-stream' }
	});
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const dec = new TextDecoder();
	let out = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		out += dec.decode(value, { stream: true });
	}
	return out;
}

beforeEach(() => guard.clearResolveCache());
afterEach(() => vi.unstubAllGlobals());

describe('endpointChat', () => {
	it('posts the model, messages and token cap with the key as a Bearer header', async () => {
		const fn = stubFetch(() =>
			json({ choices: [{ message: { content: 'hello' } }], usage: { completion_tokens: 7 } })
		);
		const out = await client.endpointChat(CALL, MESSAGES, { maxTokens: 64 });
		expect(out).toEqual({ response: 'hello', outputTokens: 7 });

		const [url, init] = fn.mock.calls.find((c) => !String(c[0]).includes('dns-query'))!;
		expect(url).toBe('https://vllm.example.com/v1/chat/completions');
		expect((init as RequestInit).redirect).toBe('manual');
		expect((init as RequestInit).headers).toMatchObject({
			authorization: 'Bearer sk-secret-key-123456'
		});
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			model: 'my-lora',
			messages: MESSAGES,
			stream: false,
			max_tokens: 64
		});
	});

	it('sends no Authorization header without a key', async () => {
		const fn = stubFetch(() => json({ choices: [{ message: { content: 'x' } }] }));
		await client.endpointChat({ ...CALL, apiKey: null }, MESSAGES);
		const init = fn.mock.calls.find((c) => !String(c[0]).includes('dns-query'))![1] as RequestInit;
		expect(init.headers).not.toHaveProperty('authorization');
	});

	it('refuses a redirect instead of following it', async () => {
		stubFetch(() => new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } }));
		await expect(client.endpointChat(CALL, MESSAGES)).rejects.toThrow(/redirected/);
	});

	it('reports an upstream error without echoing the key', async () => {
		stubFetch(
			() => new Response('bad key sk-secret-key-123456 / Bearer abcdefgh12345', { status: 401 })
		);
		const err = await client.endpointChat(CALL, MESSAGES).catch((e) => e);
		expect(err.status).toBe(401);
		expect(err.message).toContain('401');
		expect(err.message).not.toContain('sk-secret-key-123456');
		expect(err.message).not.toContain('abcdefgh12345');
	});

	it('rejects a response that is not json or has no content', async () => {
		stubFetch(() => new Response('<html>nope</html>'));
		await expect(client.endpointChat(CALL, MESSAGES)).rejects.toThrow(/not JSON/);
		stubFetch(() => json({ choices: [] }));
		await expect(client.endpointChat(CALL, MESSAGES)).rejects.toThrow(/no message content/);
	});

	it('caps the response size', async () => {
		stubFetch(() => new Response('x'.repeat(1024 * 1024 + 10)));
		await expect(client.endpointChat(CALL, MESSAGES)).rejects.toThrow(/too large/);
	});

	it('never calls an address the hostname resolves to when it is private', async () => {
		const fn = stubFetch(() => json({ choices: [{ message: { content: 'x' } }] }), ['10.0.0.8']);
		await expect(client.endpointChat(CALL, MESSAGES)).rejects.toThrow(/non-public/);
		expect(fn.mock.calls.every((c) => String(c[0]).includes('dns-query'))).toBe(true);
	});

	it('re-checks the saved url itself, so a bad row cannot be called', async () => {
		const fn = stubFetch(() => json({}));
		await expect(
			client.endpointChat({ ...CALL, baseUrl: 'http://169.254.169.254/latest' }, MESSAGES)
		).rejects.toThrow(/https/);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe('endpointChatStream', () => {
	it('turns openai deltas into the response frames the widget reads', async () => {
		stubFetch(() =>
			sse([
				'data: {"choices":[{"delta":{"role":"assistant"}}]}',
				'data: {"choices":[{"delta":{"content":"Hel"}}]}',
				'data: {"choices":[{"delta":{"content":"lo"}}]}',
				': keep-alive',
				'data: [DONE]'
			])
		);
		const text = await readAll(await client.endpointChatStream(CALL, MESSAGES));
		const frames = text
			.split('\n\n')
			.filter(Boolean)
			.map((f) => f.replace(/^data: /, ''));
		expect(frames).toEqual(['{"response":"Hel"}', '{"response":"lo"}', '[DONE]']);
	});

	it('handles a frame split across chunks', async () => {
		stubFetch(() => {
			const enc = new TextEncoder();
			const body = new ReadableStream<Uint8Array>({
				start(c) {
					c.enqueue(enc.encode('data: {"choices":[{"delta":{"con'));
					c.enqueue(enc.encode('tent":"split"}}]}\n\ndata: [DONE]\n\n'));
					c.close();
				}
			});
			return new Response(body);
		});
		const text = await readAll(await client.endpointChatStream(CALL, MESSAGES));
		expect(text).toContain('{"response":"split"}');
	});

	it('requests a stream and surfaces an upstream failure before streaming', async () => {
		const fn = stubFetch(() => new Response('overloaded', { status: 503 }));
		await expect(client.endpointChatStream(CALL, MESSAGES)).rejects.toThrow(/503/);
		const body = JSON.parse(
			(fn.mock.calls.find((c) => !String(c[0]).includes('dns-query'))![1] as RequestInit)
				.body as string
		);
		expect(body.stream).toBe(true);
	});
});

describe('probeEndpoint', () => {
	it('lists the served models', async () => {
		stubFetch(() => json({ data: [{ id: 'base' }, { id: 'my-lora' }] }));
		expect(await client.probeEndpoint({ baseUrl: CALL.baseUrl, apiKey: CALL.apiKey })).toEqual({
			health: 'ok',
			message: 'Reachable',
			models: ['base', 'my-lora']
		});
	});

	it('maps 401 and 403 to a rejected key and other failures to unreachable', async () => {
		stubFetch(() => new Response('no', { status: 401 }));
		expect((await client.probeEndpoint(CALL)).health).toBe('auth_failed');
		stubFetch(() => new Response('no', { status: 403 }));
		expect((await client.probeEndpoint(CALL)).health).toBe('auth_failed');
		stubFetch(() => new Response('boom', { status: 500 }));
		expect((await client.probeEndpoint(CALL)).health).toBe('unreachable');
		stubFetch(() => {
			throw new Error('connect ECONNREFUSED');
		});
		expect((await client.probeEndpoint(CALL)).health).toBe('unreachable');
	});
});
