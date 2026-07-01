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
});
