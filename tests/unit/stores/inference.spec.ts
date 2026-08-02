import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInferenceStore } from '~/stores/inference';

// build a Response whose body streams the given sse frames
function sseResponse(
	frames: string[],
	init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) {
	const text = frames.join('');
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		body: stream,
		headers: { get: (k: string) => (init.headers ?? {})[k.toLowerCase()] ?? null }
	} as any;
}

// stream the given raw chunks verbatim so framing/line-ending handling is observable
function chunkedResponse(chunks: string[]) {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const enc = new TextEncoder();
			for (const c of chunks) controller.enqueue(enc.encode(c));
			controller.close();
		}
	});
	return { ok: true, status: 200, body: stream, headers: { get: () => null } } as any;
}

// an error response (non-ok) with an optional json body + retry-after header
function errorResponse(status: number, body: any, retryAfter?: string) {
	return {
		ok: false,
		status,
		json: async () => body,
		headers: {
			get: (k: string) => (k.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null)
		},
		body: null
	} as any;
}

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	localStorage.clear();
});

const PG = 'pg:pane1';

describe('inference store', () => {
	it('sendWidget streams tokens into an assistant node', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					sseResponse([
						'data: {"response":"Hel"}\n\n',
						'data: {"response":"lo"}\n\n',
						'data: [DONE]\n\n'
					])
				)
		);
		const store = useInferenceStore();
		await store.sendWidget('adp', 'hi');
		const path = store.pathOf('adp');
		expect(path.map((n) => n.role)).toEqual(['user', 'assistant']);
		expect(path[0]!.content).toBe('hi');
		expect(path[1]!.content).toBe('Hello');
		expect(store.isLoading('adp')).toBe(false);
	});

	it('parses token/delta/text keys and a trailing frame with no blank line', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					sseResponse(['data: {"token":"a"}\n\n', 'data: {"delta":"b"}\n\n', 'data: {"text":"c"}'])
				)
		);
		const store = useInferenceStore();
		await store.sendWidget('adp', 'go');
		expect(store.pathOf('adp')[1]!.content).toBe('abc');
	});

	it('treats a non-json data line as raw text', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: rawtext\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendWidget('adp', 'go');
		expect(store.pathOf('adp')[1]!.content).toBe('rawtext');
	});

	it('editWidget branches a new version off the same parent', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"one"}\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendWidget('adp', 'first');
		const userNodeId = store.pathOf('adp')[0]!.id;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"two"}\n\n', 'data: [DONE]\n\n']))
		);
		await store.editWidget('adp', userNodeId, 'edited');
		const path = store.pathOf('adp');
		expect(path[0]!.content).toBe('edited');
		// two sibling versions now exist at the root
		expect(path[0]!.versions).toEqual({ index: 2, count: 2 });
	});

	it('branch navigates between sibling versions', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"a"}\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendWidget('adp', 'v1');
		const firstUserId = store.pathOf('adp')[0]!.id;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"b"}\n\n', 'data: [DONE]\n\n']))
		);
		await store.editWidget('adp', firstUserId, 'v2');
		expect(store.pathOf('adp')[0]!.content).toBe('v2');
		// go back to the previous version
		const curId = store.pathOf('adp')[0]!.id;
		store.branch('adp', curId, -1);
		expect(store.pathOf('adp')[0]!.content).toBe('v1');
		// clamped: going further back is a no-op
		const backId = store.pathOf('adp')[0]!.id;
		store.branch('adp', backId, -1);
		expect(store.pathOf('adp')[0]!.content).toBe('v1');
	});

	it('branch is a no-op for unknown session or node', () => {
		const store = useInferenceStore();
		expect(() => store.branch('missing', 'x', 1)).not.toThrow();
	});

	it('sendPlayground streams and persists to localStorage', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"hey"}\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendPlayground(PG, { adapterId: 'adp' }, 'prompt', {
			maxTokens: 32,
			system: 'sys'
		});
		expect(store.pathOf(PG)[1]!.content).toBe('hey');
		expect(localStorage.getItem('mylora:playground:v2')).toBeTruthy();
	});

	it('editPlayground branches a playground pane', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"one"}\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendPlayground(PG, { baseModel: 'llama' }, 'p1');
		const uid = store.pathOf(PG)[0]!.id;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"two"}\n\n', 'data: [DONE]\n\n']))
		);
		await store.editPlayground(PG, { baseModel: 'llama' }, uid, 'p2');
		expect(store.pathOf(PG)[0]!.content).toBe('p2');
	});

	it('records rate-limit state on a 429 and drops the empty assistant node', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(errorResponse(429, { message: 'slow down', retryAfter: 30 }, '30'))
		);
		const store = useInferenceStore();
		await expect(store.sendWidget('adp', 'go')).rejects.toBeTruthy();
		const s = (store.sessions as any).adp;
		expect(s.rateLimited).toBe(true);
		expect(s.retryAfter).toBe(30);
		expect(s.error).toBe('slow down');
		// empty assistant placeholder removed, only the user node remains
		expect(store.pathOf('adp').map((n) => n.role)).toEqual(['user']);
	});

	it('sets a generic error on non-429 failures', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500, { message: 'boom' })));
		const store = useInferenceStore();
		await expect(store.sendWidget('adp', 'go')).rejects.toBeTruthy();
		const s = (store.sessions as any).adp;
		expect(s.rateLimited).toBe(false);
		expect(s.error).toBe('boom');
	});

	it('throws when the response has no body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				body: null,
				headers: { get: () => null }
			} as any)
		);
		const store = useInferenceStore();
		await expect(store.sendWidget('adp', 'go')).rejects.toThrow(/no response stream/i);
	});

	it('stop aborts an in-flight run and keeps a session usable', async () => {
		// fetch that rejects with an AbortError once aborted
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation((_url, opts: any) => {
				return new Promise((_resolve, reject) => {
					opts.signal.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				});
			})
		);
		const store = useInferenceStore();
		const p = store.sendWidget('adp', 'go');
		// give the microtask a tick so the controller is registered
		await Promise.resolve();
		store.stop('adp');
		await p;
		// empty assistant node dropped on abort; no error surfaced
		const s = (store.sessions as any).adp;
		expect(s.error).toBeNull();
		expect(store.pathOf('adp').map((n) => n.role)).toEqual(['user']);
	});

	it('stop is a no-op for an unknown session', () => {
		const store = useInferenceStore();
		expect(() => store.stop('nope')).not.toThrow();
	});

	it('clear resets a session and persists for playground keys', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"x"}\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendPlayground(PG, { adapterId: 'a' }, 'p');
		store.clear(PG);
		expect(store.pathOf(PG)).toEqual([]);
		// nothing to persist -> key removed
		expect(localStorage.getItem('mylora:playground:v2')).toBeNull();
	});

	it('pathOf and isLoading return empty/false for unknown sessions', () => {
		const store = useInferenceStore();
		expect(store.pathOf('nope')).toEqual([]);
		expect(store.isLoading('nope')).toBe(false);
	});

	it('hydrate restores persisted playground sessions', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"saved"}\n\n', 'data: [DONE]\n\n']))
		);
		const store = useInferenceStore();
		await store.sendPlayground(PG, { adapterId: 'a' }, 'q');
		const raw = localStorage.getItem('mylora:playground:v2');
		expect(raw).toBeTruthy();
		// fresh store instance reads it back
		setActivePinia(createPinia());
		const store2 = useInferenceStore();
		expect(store2.pathOf(PG)).toEqual([]);
		store2.hydrate();
		expect(store2.pathOf(PG)[0]!.content).toBe('q');
	});

	it('hydrate ignores malformed persisted state', () => {
		localStorage.setItem('mylora:playground:v2', '{bad json');
		const store = useInferenceStore();
		expect(() => store.hydrate()).not.toThrow();
		expect(store.pathOf(PG)).toEqual([]);
	});

	it('hydrate no-ops when nothing is stored', () => {
		const store = useInferenceStore();
		expect(() => store.hydrate()).not.toThrow();
	});

	it('auto-compacts a long playground conversation via the summarize endpoint', async () => {
		// stream one token per turn
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(sseResponse(['data: {"response":"t"}\n\n', 'data: [DONE]\n\n']))
		);
		// summarize call used by maybeCompact
		const $fetchMock = vi.fn().mockResolvedValue({ summary: 'earlier stuff' });
		vi.stubGlobal('$fetch', $fetchMock);
		const store = useInferenceStore();
		// COMPACT_AT is 14; drive well past it (each send adds 2 nodes)
		for (let i = 0; i < 9; i++) {
			vi.stubGlobal(
				'fetch',
				vi
					.fn()
					.mockResolvedValue(sseResponse([`data: {"response":"turn${i}"}\n\n`, 'data: [DONE]\n\n']))
			);
			await store.sendPlayground(PG, { adapterId: 'a' }, `msg${i}`);
		}
		expect($fetchMock).toHaveBeenCalledWith(
			'/api/infer/summarize',
			expect.objectContaining({ method: 'POST' })
		);
		const path = store.pathOf(PG);
		// first node is the injected compaction summary
		expect(path[0]!.role).toBe('system');
		expect(path[0]!.compacted).toBe(true);
		expect(path[0]!.content).toContain('earlier stuff');
	});

	it('keeps full history when summarize fails', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('llm down')));
		const store = useInferenceStore();
		for (let i = 0; i < 9; i++) {
			vi.stubGlobal(
				'fetch',
				vi
					.fn()
					.mockResolvedValue(sseResponse([`data: {"response":"t${i}"}\n\n`, 'data: [DONE]\n\n']))
			);
			await store.sendPlayground(PG, { adapterId: 'a' }, `m${i}`);
		}
		const path = store.pathOf(PG);
		// no system summary node was injected
		expect(path[0]!.role).toBe('user');
	});

	// #region versus

	// each call resolves a distinct body so alternation is visible in the transcript
	function versusFetch(reply: (body: any, call: number) => string[]) {
		let call = 0;
		return vi.fn().mockImplementation(async (_url: string, init: any) => {
			const body = JSON.parse(init.body);
			return sseResponse([...reply(body, call++), 'data: [DONE]\n\n']);
		});
	}

	const CFG = {
		topic: 'tabs or spaces',
		first: 'a' as const,
		perAgent: 2,
		maxTokens: 128,
		maxSystemChars: 2000,
		a: { target: { adapterId: 'lora-1' }, persona: 'pro', label: 'LoRA: one' },
		b: { target: { baseModel: '@cf/base' }, persona: 'con', label: 'Base: two' }
	};

	it('runVersus produces perAgent messages per side, alternating from the first speaker', async () => {
		vi.stubGlobal(
			'fetch',
			versusFetch((_b, i) => [`data: {"response":"reply ${i}"}\n\n`])
		);
		const store = useInferenceStore();
		await store.runVersus(CFG);

		expect(store.versus.messages).toHaveLength(4);
		expect(store.versus.messages.map((m) => m.side)).toEqual(['a', 'b', 'a', 'b']);
		expect(store.versus.messages.map((m) => m.content)).toEqual([
			'reply 0',
			'reply 1',
			'reply 2',
			'reply 3'
		]);
		expect(store.versus.total).toBe(4);
		expect(store.versus.running).toBe(false);
		expect(store.versus.stopped).toBe('done');
		expect(store.versus.error).toBeNull();
	});

	it('runVersus starts with the other side when first is b', async () => {
		vi.stubGlobal(
			'fetch',
			versusFetch(() => ['data: {"response":"x"}\n\n'])
		);
		const store = useInferenceStore();
		await store.runVersus({ ...CFG, first: 'b', perAgent: 1 });
		expect(store.versus.messages.map((m) => m.side)).toEqual(['b', 'a']);
	});

	it('runVersus sends each side its own target, persona and role-swapped history', async () => {
		const bodies: any[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async (_url: string, init: any) => {
				bodies.push(JSON.parse(init.body));
				return sseResponse([`data: {"response":"m${bodies.length - 1}"}\n\n`, 'data: [DONE]\n\n']);
			})
		);
		const store = useInferenceStore();
		await store.runVersus(CFG);

		expect(bodies).toHaveLength(4);
		// side a runs the lora, side b the bare base model
		expect(bodies[0].adapterId).toBe('lora-1');
		expect(bodies[1].baseModel).toBe('@cf/base');
		expect(bodies[0].maxTokens).toBe(128);
		expect(bodies[0].system).toContain('pro');
		expect(bodies[0].system).toContain('Topic: tabs or spaces');
		expect(bodies[1].system).toContain('con');

		// turn 1: nothing to answer yet, so the topic is the user turn
		expect(bodies[0].messages).toEqual([{ role: 'user', content: 'tabs or spaces' }]);
		// turn 2: side b sees side a's reply as a user turn
		expect(bodies[1].messages).toEqual([{ role: 'user', content: 'm0' }]);
		// turn 3: side a sees its own reply as assistant, re-opened with the topic so the
		// conversation still starts on `user` (workers AI rejects a leading assistant turn)
		expect(bodies[2].messages).toEqual([
			{ role: 'user', content: 'tabs or spaces' },
			{ role: 'assistant', content: 'm0' },
			{ role: 'user', content: 'm1' }
		]);
		// every request must satisfy the alternating contract
		for (const body of bodies) {
			expect(body.messages[0].role).toBe('user');
			body.messages.forEach((m: any, i: number) => {
				expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
			});
		}
	});

	it('runVersus omits the system field entirely when system prompts are disabled', async () => {
		const bodies: any[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async (_url: string, init: any) => {
				bodies.push(JSON.parse(init.body));
				return sseResponse(['data: {"response":"x"}\n\n', 'data: [DONE]\n\n']);
			})
		);
		const store = useInferenceStore();
		await store.runVersus({ ...CFG, perAgent: 1, maxSystemChars: 0 });
		expect(bodies[0]).not.toHaveProperty('system');
	});

	it('runVersus keeps the partial transcript and flags the limit on a mid-run 429', async () => {
		let call = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => {
				call++;
				if (call === 3)
					return errorResponse(429, { message: 'Hourly prompt limit reached' }, '900');
				return sseResponse([`data: {"response":"t${call}"}\n\n`, 'data: [DONE]\n\n']);
			})
		);
		const store = useInferenceStore();
		await store.runVersus(CFG);

		// two completed messages survive; the empty third placeholder is dropped
		expect(store.versus.messages).toHaveLength(2);
		expect(store.versus.messages.map((m) => m.content)).toEqual(['t1', 't2']);
		expect(store.versus.stopped).toBe('limit');
		expect(store.versus.retryAfter).toBe(900);
		expect(store.versus.error).toBe('Hourly prompt limit reached');
		expect(store.versus.running).toBe(false);
	});

	it('runVersus stops on a non-429 failure without discarding earlier messages', async () => {
		let call = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => {
				call++;
				if (call === 2) return errorResponse(502, { message: 'upstream boom' });
				return sseResponse([`data: {"response":"t${call}"}\n\n`, 'data: [DONE]\n\n']);
			})
		);
		const store = useInferenceStore();
		await store.runVersus(CFG);
		expect(store.versus.messages.map((m) => m.content)).toEqual(['t1']);
		expect(store.versus.stopped).toBe('error');
		expect(store.versus.error).toBe('upstream boom');
	});

	it('runVersus ends the run when a model returns nothing rather than looping on empty turns', async () => {
		let call = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async () => {
				call++;
				return sseResponse(
					call === 1 ? ['data: {"response":"only"}\n\n', 'data: [DONE]\n\n'] : ['data: [DONE]\n\n']
				);
			})
		);
		const store = useInferenceStore();
		await store.runVersus(CFG);
		expect(store.versus.messages.map((m) => m.content)).toEqual(['only']);
		expect(store.versus.stopped).toBe('error');
		expect(store.versus.error).toBe('The model returned an empty response');
	});

	it('stopVersus aborts the run and keeps what already streamed', async () => {
		const store = useInferenceStore();
		let call = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockImplementation(async (_url: string, init: any) => {
				call++;
				if (call === 2) {
					store.stopVersus();
					const err: any = new Error('aborted');
					err.name = 'AbortError';
					throw err;
				}
				init;
				return sseResponse(['data: {"response":"first"}\n\n', 'data: [DONE]\n\n']);
			})
		);
		await store.runVersus(CFG);
		expect(store.versus.messages.map((m) => m.content)).toEqual(['first']);
		expect(store.versus.stopped).toBe('user');
		expect(store.versus.running).toBe(false);
	});

	it('runVersus refuses to start a second run while one is in flight', async () => {
		const fetchMock = versusFetch(() => ['data: {"response":"x"}\n\n']);
		vi.stubGlobal('fetch', fetchMock);
		const store = useInferenceStore();
		const first = store.runVersus({ ...CFG, perAgent: 1 });
		await store.runVersus({ ...CFG, perAgent: 1 });
		await first;
		// only the first run's two calls happened
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('records the labels so the thread can title each side', async () => {
		vi.stubGlobal(
			'fetch',
			versusFetch(() => ['data: {"response":"x"}\n\n'])
		);
		const store = useInferenceStore();
		await store.runVersus({ ...CFG, perAgent: 1 });
		expect(store.versus.labels).toEqual({ a: 'LoRA: one', b: 'Base: two' });
		expect(store.versus.topic).toBe('tabs or spaces');
	});

	it('persists a finished match and rehydrates it', async () => {
		vi.stubGlobal(
			'fetch',
			versusFetch(() => ['data: {"response":"kept"}\n\n'])
		);
		const store = useInferenceStore();
		await store.runVersus({ ...CFG, perAgent: 1 });
		expect(localStorage.getItem('mylora:versus:v1')).toBeTruthy();

		setActivePinia(createPinia());
		const fresh = useInferenceStore();
		expect(fresh.versus.messages).toHaveLength(0);
		fresh.hydrateVersus();
		expect(fresh.versus.messages.map((m) => m.content)).toEqual(['kept', 'kept']);
		expect(fresh.versus.topic).toBe('tabs or spaces');
		expect(fresh.versus.stopped).toBe('done');
		expect(fresh.versus.running).toBe(false);
	});

	it('clearVersus empties the transcript and the persisted copy', async () => {
		vi.stubGlobal(
			'fetch',
			versusFetch(() => ['data: {"response":"x"}\n\n'])
		);
		const store = useInferenceStore();
		await store.runVersus({ ...CFG, perAgent: 1 });
		store.clearVersus();
		expect(store.versus.messages).toHaveLength(0);
		expect(store.versus.stopped).toBeNull();
		expect(localStorage.getItem('mylora:versus:v1')).toBeNull();
	});

	it('hydrateVersus ignores malformed persisted state', () => {
		localStorage.setItem('mylora:versus:v1', '{ not json');
		const store = useInferenceStore();
		store.hydrateVersus();
		expect(store.versus.messages).toEqual([]);

		localStorage.setItem('mylora:versus:v1', JSON.stringify({ messages: 'nope' }));
		store.hydrateVersus();
		expect(store.versus.messages).toEqual([]);
	});

	// #endregion

	// #region sse framing

	describe('sse framing', () => {
		const frame = (t: string) => `data: ${JSON.stringify({ response: t })}\n\n`;

		async function collect(chunks: string[]) {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(chunkedResponse(chunks)));
			const store = useInferenceStore();
			await store.sendWidget('ad-sse', 'go');
			return store.pathOf('ad-sse').at(-1)!.content;
		}

		it('joins tokens delivered one frame per chunk', async () => {
			expect(await collect([frame('Hello'), frame(' world'), 'data: [DONE]\n\n'])).toBe(
				'Hello world'
			);
		});

		it('joins tokens batched into a single chunk', async () => {
			expect(await collect([frame('Hello') + frame(' world') + 'data: [DONE]\n\n'])).toBe(
				'Hello world'
			);
		});

		it('reassembles a frame split mid-json across chunks', async () => {
			expect(
				await collect(['data: {"resp', 'onse":"Hello"}\n\n', frame(' world'), 'data: [DONE]\n\n'])
			).toBe('Hello world');
		});

		it('keeps every data line when several share one frame', async () => {
			// regression: only the first data: line was read, silently dropping the rest
			expect(
				await collect([
					'data: {"response":"Hello"}\ndata: {"response":" world"}\n\n',
					'data: [DONE]\n\n'
				])
			).toBe('Hello world');
		});

		it('handles crlf line endings', async () => {
			// regression: splitting on '\n\n' never matched '\r\n\r\n', so the stream never framed
			expect(
				await collect([
					'data: {"response":"Hello"}\r\n\r\n',
					'data: {"response":" world"}\r\n\r\n',
					'data: [DONE]\r\n\r\n'
				])
			).toBe('Hello world');
		});

		it('flushes a trailing frame that never got a blank line', async () => {
			expect(await collect([frame('Hello'), 'data: {"response":" world"}'])).toBe('Hello world');
		});

		it('stops at [DONE] and ignores anything after it', async () => {
			expect(await collect([frame('Hello'), 'data: [DONE]\n\n', frame(' extra')])).toBe('Hello');
		});

		it('preserves a token that is itself a newline', async () => {
			expect(await collect([frame('a'), frame('\n'), frame('b'), 'data: [DONE]\n\n'])).toBe('a\nb');
		});

		it('accepts the alternate delta field names', async () => {
			expect(
				await collect([
					'data: {"token":"a"}\n\n',
					'data: {"delta":"b"}\n\n',
					'data: {"text":"c"}\n\n',
					'data: [DONE]\n\n'
				])
			).toBe('abc');
		});

		it('treats a non-json data line as raw text', async () => {
			expect(await collect(['data: plain text\n\n', 'data: [DONE]\n\n'])).toBe('plain text');
		});

		it('ignores comment and event lines', async () => {
			expect(
				await collect([': keep-alive\n\n', 'event: message\n' + frame('ok'), 'data: [DONE]\n\n'])
			).toBe('ok');
		});
	});

	// #endregion
});
