export type ChatRole = 'user' | 'assistant' | 'system';
export type ChatMessage = { role: ChatRole; content: string };

export type ChatNode = {
	id: string;
	role: ChatRole;
	content: string;
	parentId: string | null;
	children: string[];
	compacted?: boolean;
};

export type PathNode = {
	id: string;
	role: ChatRole;
	content: string;
	compacted?: boolean;
	// when this node has sibling branches, version nav is shown (1-based index, total count)
	versions: { index: number; count: number } | null;
};

export type ChatSession = {
	nodes: Record<string, ChatNode>;
	roots: string[];
	// active child index per fork; key is the parent id, or '' for the root level
	selection: Record<string, number>;
	loading: boolean;
	error: string | null;
	rateLimited: boolean;
	retryAfter: number | null;
};

function newSession(): ChatSession {
	return {
		nodes: {},
		roots: [],
		selection: {},
		loading: false,
		error: null,
		rateLimited: false,
		retryAfter: null
	};
}

let idSeq = 0;
function uid(): string {
	if (import.meta.client && typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	idSeq += 1;
	return `n${idSeq}`;
}

const PG_PREFIX = 'pg:';
const STORE_KEY = 'mylora:playground:v2';
const COMPACT_AT = 14; // auto-compact the active path once it exceeds this many turns
const COMPACT_KEEP = 6;

function childrenOf(s: ChatSession, parentId: string | null): string[] {
	return parentId ? (s.nodes[parentId]?.children ?? []) : s.roots;
}

function activePath(s: ChatSession): ChatNode[] {
	const path: ChatNode[] = [];
	let list = s.roots;
	let key = '';
	while (list.length) {
		const fallback = list.length - 1;
		const idx = Math.min(Math.max(s.selection[key] ?? fallback, 0), fallback);
		const node = s.nodes[list[idx]!];
		if (!node) break;
		path.push(node);
		key = node.id;
		list = node.children;
	}
	return path;
}

// append a node under parentId and make it the active branch; returns its id
function appendNode(
	s: ChatSession,
	role: ChatRole,
	content: string,
	parentId: string | null
): string {
	const id = uid();
	s.nodes[id] = { id, role, content, parentId, children: [] };
	const list = childrenOf(s, parentId);
	list.push(id);
	s.selection[parentId ?? ''] = list.length - 1;
	return id;
}

// remove a node (only used for empty assistant placeholders on abort/error)
function dropNode(s: ChatSession, id: string) {
	const node = s.nodes[id];
	if (!node) return;
	const list = childrenOf(s, node.parentId);
	const i = list.indexOf(id);
	if (i >= 0) list.splice(i, 1);
	delete s.nodes[id];
	const key = node.parentId ?? '';
	if ((s.selection[key] ?? 0) >= list.length) s.selection[key] = Math.max(0, list.length - 1);
}

// last node on the active path (the point new turns attach to)
function activeLeaf(s: ChatSession): string | null {
	const path = activePath(s);
	return path.length ? path[path.length - 1]!.id : null;
}

// per-adapter chat sessions for the widget and the streaming playground
export const useInferenceStore = defineStore('inference', () => {
	const sessions = ref<Record<string, ChatSession>>({});
	// abort controllers per session so the prompt's stop button can cancel an in-flight run
	const controllers: Record<string, AbortController> = {};

	function ensure(key: string): ChatSession {
		if (!sessions.value[key]) sessions.value[key] = newSession();
		return sessions.value[key]!;
	}

	// the active conversation path for a session, with branch nav info (read by components)
	function pathOf(key: string): PathNode[] {
		const s = sessions.value[key];
		if (!s) return [];
		return activePath(s).map((node) => {
			const siblings = childrenOf(s, node.parentId);
			const count = siblings.length;
			const index = siblings.indexOf(node.id);
			return {
				id: node.id,
				role: node.role,
				content: node.content,
				compacted: node.compacted,
				versions: count > 1 ? { index: index + 1, count } : null
			};
		});
	}

	function isLoading(key: string): boolean {
		return !!sessions.value[key]?.loading;
	}

	// switch the active branch at a fork (dir -1 previous, +1 next version)
	function branch(key: string, nodeId: string, dir: number) {
		const s = sessions.value[key];
		const node = s?.nodes[nodeId];
		if (!s || !node) return;
		const siblings = childrenOf(s, node.parentId);
		const cur = siblings.indexOf(nodeId);
		const next = Math.min(Math.max(cur + dir, 0), siblings.length - 1);
		if (next === cur) return;
		s.selection[node.parentId ?? ''] = next;
		if (key.startsWith(PG_PREFIX)) persist();
	}

	// persist playground conversations only (the widget is intentionally ephemeral)
	function persist() {
		if (!import.meta.client) return;
		const out: Record<string, Pick<ChatSession, 'nodes' | 'roots' | 'selection'>> = {};
		for (const [k, s] of Object.entries(sessions.value)) {
			if (k.startsWith(PG_PREFIX) && s.roots.length) {
				out[k] = { nodes: s.nodes, roots: s.roots, selection: s.selection };
			}
		}
		try {
			if (Object.keys(out).length) localStorage.setItem(STORE_KEY, JSON.stringify(out));
			else localStorage.removeItem(STORE_KEY);
		} catch {
			// storage may be unavailable (private mode); persistence is best-effort
		}
	}

	function hydrate() {
		if (!import.meta.client) return;
		try {
			const raw = localStorage.getItem(STORE_KEY);
			if (!raw) return;
			const data = JSON.parse(raw) as Record<string, Partial<ChatSession>>;
			for (const [k, saved] of Object.entries(data)) {
				if (k.startsWith(PG_PREFIX) && saved?.nodes && Array.isArray(saved.roots)) {
					sessions.value[k] = {
						...newSession(),
						nodes: saved.nodes as Record<string, ChatNode>,
						roots: saved.roots,
						selection: saved.selection ?? {}
					};
				}
			}
		} catch {
			// ignore malformed persisted state
		}
	}

	// rebuild a session as a fresh linear chain (used after compaction)
	function rebuildLinear(s: ChatSession, items: (ChatMessage & { compacted?: boolean })[]) {
		s.nodes = {};
		s.roots = [];
		s.selection = {};
		let parent: string | null = null;
		for (const it of items) {
			const id = appendNode(s, it.role, it.content, parent);
			if (it.compacted) s.nodes[id]!.compacted = true;
			parent = id;
		}
	}

	async function maybeCompact(key: string) {
		if (!key.startsWith(PG_PREFIX)) return;
		const s = sessions.value[key];
		if (!s) return;
		const path = activePath(s);
		if (path.length <= COMPACT_AT) return;
		const keep = path.slice(-COMPACT_KEEP);
		const older = path.slice(0, -COMPACT_KEEP);
		const text = older
			.filter((n) => n.content?.trim())
			.map((n) => `${n.role}: ${n.content}`)
			.join('\n');
		if (!text.trim()) return;
		try {
			const { summary } = await $fetch<{ summary: string }>('/api/infer/summarize', {
				method: 'POST',
				body: { text }
			});
			if (!summary?.trim()) return;
			rebuildLinear(s, [
				{
					role: 'system',
					content: `Summary of earlier conversation:\n${summary.trim()}`,
					compacted: true
				},
				...keep.map((n) => ({ role: n.role, content: n.content }))
			]);
		} catch {
			// summarization is best-effort; keep the full history on failure
		}
	}

	function isAbort(e: any) {
		return e?.name === 'AbortError' || e?.cause?.name === 'AbortError';
	}

	// cancel an in-flight inference for a session (keeps whatever streamed so far)
	function stop(key: string) {
		controllers[key]?.abort();
	}

	// read an sse stream into a specific node's content; throws on non-ok (incl. 429)
	async function consumeNode(
		s: ChatSession,
		nodeId: string,
		url: string,
		body: unknown,
		controller: AbortController
	) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: controller.signal
		});
		if (!res.ok) {
			let data: any;
			try {
				data = await res.json();
			} catch {
				data = undefined;
			}
			const retryAfter = res.headers.get('retry-after');
			throw Object.assign(new Error(data?.message ?? `Inference failed (${res.status})`), {
				statusCode: res.status,
				data,
				retryAfter
			});
		}
		if (!res.body) throw new Error('No response stream');
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const frames = buffer.split('\n\n');
			buffer = frames.pop() ?? '';
			for (const frame of frames) {
				const token = parseFrame(frame);
				if (token === DONE) return;
				if (token && s.nodes[nodeId]) s.nodes[nodeId]!.content += token;
			}
		}
		const tail = parseFrame(buffer);
		if (tail && tail !== DONE && s.nodes[nodeId]) s.nodes[nodeId]!.content += tail;
	}

	// shared run: attach a new user node under parentId, stream the assistant reply, account/persist.
	// payload(history) builds the request body from the active-path messages (incl. the new user turn)
	async function runTurn(
		key: string,
		parentId: string | null,
		content: string,
		url: string,
		payload: (history: ChatMessage[]) => Record<string, unknown>
	) {
		const s = ensure(key);
		s.error = null;
		s.rateLimited = false;
		s.retryAfter = null;
		const userId = appendNode(s, 'user', content, parentId);
		const asstId = appendNode(s, 'assistant', '', userId);
		// history is the active path up to (and including) the new user turn
		const history = activePath(s)
			.filter((n) => n.id !== asstId)
			.map((n) => ({ role: n.role, content: n.content }));
		const controller = new AbortController();
		controllers[key] = controller;
		s.loading = true;
		let ok = false;
		try {
			await consumeNode(s, asstId, url, payload(history), controller);
			ok = true;
		} catch (e: any) {
			if (isAbort(e)) {
				if (!s.nodes[asstId]?.content) dropNode(s, asstId);
			} else {
				if (!s.nodes[asstId]?.content) dropNode(s, asstId);
				applyError(s, e);
				throw e;
			}
		} finally {
			delete controllers[key];
			s.loading = false;
		}
		if (ok) {
			await maybeCompact(key);
		}
		if (key.startsWith(PG_PREFIX)) persist();
	}

	// streaming widget inference; renders tokens live, on 429 records rate-limit state
	async function sendWidget(adapterId: string, prompt: string, system?: string) {
		const s = ensure(adapterId);
		const parentId = activeLeaf(s);
		await runTurn(adapterId, parentId, prompt, '/api/infer/widget', (history) => ({
			adapterId,
			messages: history,
			system
		}));
	}

	// edit a user turn in the widget: branch a new version off the same parent, then re-run
	async function editWidget(adapterId: string, nodeId: string, content: string, system?: string) {
		const s = ensure(adapterId);
		const parentId = s.nodes[nodeId]?.parentId ?? null;
		await runTurn(adapterId, parentId, content, '/api/infer/widget', (history) => ({
			adapterId,
			messages: history,
			system
		}));
	}

	// streaming playground inference; target is an adapter or a bare base model
	async function sendPlayground(
		key: string,
		target: { adapterId?: string; baseModel?: string },
		prompt: string,
		opts: { maxTokens?: number; system?: string } = {}
	) {
		const s = ensure(key);
		const parentId = activeLeaf(s);
		await runTurn(key, parentId, prompt, '/api/infer/playground', (history) => ({
			...target,
			messages: history,
			maxTokens: opts.maxTokens,
			system: opts.system
		}));
	}

	// edit a user turn in a playground pane: branch a new version, then re-run that pane
	async function editPlayground(
		key: string,
		target: { adapterId?: string; baseModel?: string },
		nodeId: string,
		content: string,
		opts: { maxTokens?: number; system?: string } = {}
	) {
		const s = ensure(key);
		const parentId = s.nodes[nodeId]?.parentId ?? null;
		await runTurn(key, parentId, content, '/api/infer/playground', (history) => ({
			...target,
			messages: history,
			maxTokens: opts.maxTokens,
			system: opts.system
		}));
	}

	function clear(key: string) {
		sessions.value[key] = newSession();
		if (key.startsWith(PG_PREFIX)) persist();
	}

	// hydrate is called from the playground on mount (not in setup) so it runs AFTER pinia restores
	// the ssr payload, which would otherwise overwrite the loaded sessions with empty state
	return {
		sessions,
		pathOf,
		isLoading,
		branch,
		sendWidget,
		editWidget,
		sendPlayground,
		editPlayground,
		clear,
		stop,
		hydrate
	};
});

const DONE = Symbol('done');

// parse a single sse frame; returns the text delta, DONE sentinel, or '' to skip
function parseFrame(frame: string): string | typeof DONE {
	const line = frame
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.startsWith('data:'));
	if (!line) return '';
	const payload = line.slice('data:'.length).trim();
	if (!payload) return '';
	if (payload === '[DONE]') return DONE;
	try {
		const json = JSON.parse(payload);
		return json.response ?? json.token ?? json.delta ?? json.text ?? '';
	} catch {
		// non-json data line; treat as raw text
		return payload;
	}
}

// extract a 429 rate-limit signal from a thrown error, else set a generic message
function applyError(s: ChatSession, e: any) {
	const code = e?.statusCode ?? e?.status ?? e?.response?.status;
	if (code === 429) {
		s.rateLimited = true;
		const ra = e?.retryAfter ?? e?.data?.retryAfter ?? e?.data?.data?.retryAfter;
		const n = typeof ra === 'string' ? parseInt(ra, 10) : ra;
		s.retryAfter = Number.isFinite(n) ? n : null;
		s.error = e?.data?.message ?? 'Rate limit reached';
	} else {
		s.error = e?.data?.message ?? e?.message ?? 'Inference failed';
	}
}
