<template>
	<div class="flex flex-col gap-4">
		<!-- mode toggle + controls -->
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex flex-wrap gap-2">
				<UButton
					size="sm"
					icon="mdi:message-text"
					:variant="mode === 'single' ? 'solid' : 'outline'"
					color="primary"
					@click="setMode('single')"
				>
					Single
				</UButton>
				<UButton
					size="sm"
					icon="mdi:compare-horizontal"
					:variant="mode === 'compare' ? 'solid' : 'outline'"
					color="primary"
					@click="setMode('compare')"
				>
					Compare
				</UButton>
			</div>
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-1.5">
					<label
						for="pg-max-tokens"
						class="text-xs text-muted whitespace-nowrap"
					>
						Max Tokens
					</label>
					<UInput
						id="pg-max-tokens"
						v-model.number="maxTokens"
						type="number"
						:min="16"
						:max="maxTokenCeiling"
						size="sm"
						class="w-24"
					/>
				</div>
				<UButton
					v-if="canShowDiff"
					size="sm"
					icon="mdi:file-compare"
					variant="outline"
					color="primary"
					@click="showDiff = true"
				>
					Compare Text
				</UButton>
				<template v-if="anyMessages">
					<UTooltip :text="exporter.copied.value ? 'Copied' : 'Copy Conversation'">
						<UButton
							:icon="exporter.copied.value ? 'mdi:check' : 'mdi:content-copy'"
							size="sm"
							variant="ghost"
							color="neutral"
							aria-label="Copy Conversation"
							@click="copyAll"
						/>
					</UTooltip>
					<UTooltip text="Download Conversation">
						<UButton
							icon="mdi:download"
							size="sm"
							variant="ghost"
							color="neutral"
							aria-label="Download Conversation"
							@click="downloadAll"
						/>
					</UTooltip>
					<UButton
						size="sm"
						icon="mdi:broom"
						variant="ghost"
						color="neutral"
						@click="clearAll"
					>
						Clear
					</UButton>
				</template>
			</div>
		</div>

		<p
			v-if="mode === 'compare'"
			class="text-xs text-muted"
		>
			Send one prompt to two targets. Pick a base model to compare against "no adapter"; at least
			one side must be a published LoRA adapter.
		</p>
		<UAlert
			v-if="mode === 'compare' && !canCompare"
			color="warning"
			variant="subtle"
			icon="mdi:alert"
			title="Select at least one published LoRA adapter to compare."
		/>

		<div v-if="maxSystemChars > 0">
			<UButton
				:icon="showSystem ? 'mdi:chevron-down' : 'mdi:chevron-right'"
				size="xs"
				variant="link"
				color="neutral"
				class="px-0"
				@click="showSystem = !showSystem"
			>
				System Message
			</UButton>
			<UTextarea
				v-if="showSystem"
				v-model="systemPrompt"
				:rows="2"
				:maxlength="maxSystemChars"
				placeholder="Optional system instructions sent to every target..."
				class="mt-1 w-full"
			/>
		</div>

		<div :class="mode === 'compare' ? 'grid gap-4 lg:grid-cols-2' : ''">
			<div
				v-for="pane in panes"
				:key="pane.key"
				class="flex flex-col gap-2 rounded-lg border border-default p-3 bg-elevated/50"
			>
				<USelectMenu
					:model-value="pane.valueRef.value"
					:items="options"
					value-key="value"
					placeholder="Select a base model or LoRA adapter"
					class="w-full"
					@update:model-value="pane.valueRef.value = $event"
				/>

				<AiContextMeter
					v-if="inference.pathOf(pane.key).length"
					:used="usedTokens(pane.key)"
					:total="contextFor(pane.valueRef.value)"
				/>

				<AiChatThread
					:nodes="inference.pathOf(pane.key)"
					:loading="inference.isLoading(pane.key)"
					editable
					class="min-h-[36vh] max-h-[56vh] rounded-lg bg-default/60 p-3"
					@edit="onEdit(pane.key, pane.valueRef, $event)"
					@branch="onBranch(pane.key, $event)"
				>
					<template #empty>
						{{
							targetIsAdapter(pane.valueRef.value)
								? 'Testing with the LoRA attached.'
								: 'Testing the base model with no adapter.'
						}}
					</template>
				</AiChatThread>

				<UAlert
					v-if="sessionFor(pane.key).error"
					color="error"
					variant="subtle"
					icon="mdi:alert-circle"
					:title="sessionFor(pane.key).error || ''"
				/>
			</div>
		</div>

		<UChatPrompt
			v-model="prompt"
			:status="globalStatus"
			:placeholder="mode === 'compare' ? 'Message both targets...' : 'Message the model...'"
			@submit="onSubmit"
			@stop="stopAll"
		>
			<UChatPromptSubmit
				:status="globalStatus"
				@stop="stopAll"
			/>
		</UChatPrompt>

		<UModal
			v-model:open="showDiff"
			title="Compare Responses"
			:ui="{ content: 'max-w-4xl' }"
		>
			<template #body>
				<AiCompareDiff
					:pairs="diffPairs"
					:label-a="labelFor(valueA)"
					:label-b="labelFor(valueB)"
				/>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
import type { ChatSession, PathNode } from '~/stores/inference';

type ModelInfo = { model: string; modelType: string; contextWindow?: number };

const inference = useInferenceStore();
const settings = useSettingsStore();
const { limits } = storeToRefs(settings);

// configurable per-request response cap; the server clamps to limits.maxOutputTokens
const maxTokenCeiling = computed(() => limits.value.maxOutputTokens);
const maxTokens = ref(maxTokenCeiling.value);
watch(maxTokenCeiling, (ceil) => {
	if (maxTokens.value > ceil) maxTokens.value = ceil;
});

// optional system prompt applied to every pane
const maxSystemChars = computed(() => limits.value.maxSystemPromptChars);
const systemPrompt = ref('');
const showSystem = ref(false);

const mode = ref<'single' | 'compare'>('single');
const prompt = ref('');
const models = ref<ModelInfo[]>([]);
const publishedAdapters = ref<Adapter[]>([]);
const showDiff = ref(false);

// one value per pane; encoded as `adapter:<id>` or `base:<model>`
const valueSingle = ref('');
const valueA = ref('');
const valueB = ref('');

const SINGLE_KEY = 'pg:single';
const A_KEY = 'pg:cmpA';
const B_KEY = 'pg:cmpB';

// persisted target selections (conversations themselves persist via the inference store);
// hydrated gates the clear-on-change watchers so restoring defaults never wipes saved history
const SEL_KEY = 'mylora:playground:targets:v1';
const hydrated = ref(false);
const exporter = useChatExport();

function loadSel(): { mode?: string; single?: string; a?: string; b?: string } | null {
	if (!import.meta.client) return null;
	try {
		return JSON.parse(localStorage.getItem(SEL_KEY) || 'null');
	} catch {
		return null;
	}
}
function saveSel() {
	if (!import.meta.client) return;
	try {
		localStorage.setItem(
			SEL_KEY,
			JSON.stringify({
				mode: mode.value,
				single: valueSingle.value,
				a: valueA.value,
				b: valueB.value
			})
		);
	} catch {
		// best-effort
	}
}

const EMPTY: ChatSession = {
	nodes: {},
	roots: [],
	selection: {},
	loading: false,
	error: null,
	rateLimited: false,
	retryAfter: null
};

function short(model: string) {
	return model.split('/').pop() || model;
}

onMounted(async () => {
	// restore persisted playground conversations before defaults/selections are applied
	inference.hydrate();
	const [m, a] = await Promise.all([
		$fetch<ModelInfo[]>('/api/infer/models').catch(() => []),
		$fetch<{ items: Adapter[] }>('/api/adapters/list', {
			query: { pageSize: 100, sort: 'newest' }
		}).catch(() => ({ items: [] }))
	]);
	models.value = Array.isArray(m) ? m : [];
	// published + migrated adapters are testable in the playground
	publishedAdapters.value = (a.items ?? []).filter((x) => isTestable(x.status));

	// defaults: single -> first adapter (else first base); compare -> adapter vs its own base model
	const firstAdapter = publishedAdapters.value[0];
	const firstBase = models.value[0]?.model;
	valueSingle.value = firstAdapter
		? `adapter:${firstAdapter.id}`
		: firstBase
			? `base:${firstBase}`
			: '';
	if (firstAdapter) {
		valueA.value = `adapter:${firstAdapter.id}`;
		valueB.value = `base:${firstAdapter.baseModel}`;
	} else if (firstBase) {
		valueA.value = `base:${firstBase}`;
	}

	const valid = new Set(options.value.map((o) => o.value));
	const sel = loadSel();
	if (sel) {
		if (sel.mode === 'single' || sel.mode === 'compare') mode.value = sel.mode;
		if (sel.single) {
			if (valid.has(sel.single)) valueSingle.value = sel.single;
			else inference.clear(SINGLE_KEY);
		}
		if (sel.a) {
			if (valid.has(sel.a)) valueA.value = sel.a;
			else inference.clear(A_KEY);
		}
		if (sel.b) {
			if (valid.has(sel.b)) valueB.value = sel.b;
			else inference.clear(B_KEY);
		}
	}

	// selections are settled; enable the clear-on-change watchers for genuine user changes
	await nextTick();
	hydrated.value = true;
});

const options = computed(() => [
	...publishedAdapters.value.map((a) => ({
		// include the base model so it's clear what each lora runs on
		label: `LoRA: ${a.name} (${short(a.baseModel)})`,
		value: `adapter:${a.id}`
	})),
	...models.value.map((m) => ({ label: `Base: ${short(m.model)}`, value: `base:${m.model}` }))
]);

function targetIsAdapter(value: string) {
	return value.startsWith('adapter:');
}

function targetOf(value: string): { adapterId?: string; baseModel?: string } | null {
	if (value.startsWith('adapter:')) return { adapterId: value.slice('adapter:'.length) };
	if (value.startsWith('base:')) return { baseModel: value.slice('base:'.length) };
	return null;
}

// the base model behind a target value (adapter -> its base; base -> itself)
function modelOf(value: string): string {
	if (value.startsWith('adapter:')) {
		const id = value.slice('adapter:'.length);
		return publishedAdapters.value.find((a) => a.id === id)?.baseModel ?? '';
	}
	if (value.startsWith('base:')) return value.slice('base:'.length);
	return '';
}

function contextFor(value: string): number {
	return contextWindowFor(modelOf(value));
}

function usedTokens(key: string): number {
	return estimateTokens(
		inference
			.pathOf(key)
			.map((n) => n.content)
			.join('\n')
	);
}

const panes = computed(() =>
	mode.value === 'single'
		? [{ key: SINGLE_KEY, valueRef: valueSingle }]
		: [
				{ key: A_KEY, valueRef: valueA },
				{ key: B_KEY, valueRef: valueB }
			]
);

function sessionFor(key: string): ChatSession {
	return inference.sessions[key] ?? EMPTY;
}

const canCompare = computed(() =>
	mode.value !== 'compare' ? true : [valueA.value, valueB.value].some(targetIsAdapter)
);

const anyMessages = computed(() => panes.value.some((p) => inference.pathOf(p.key).length > 0));

const globalStatus = computed<'submitted' | 'streaming' | 'ready' | 'error'>(() =>
	panes.value.some((p) => inference.isLoading(p.key)) ? 'streaming' : 'ready'
);

function setMode(m: 'single' | 'compare') {
	mode.value = m;
	saveSel();
}

function clearAll() {
	[SINGLE_KEY, A_KEY, B_KEY].forEach((k) => inference.clear(k));
}

// cancel any in-flight runs across the visible panes
function stopAll() {
	panes.value.forEach((p) => inference.stop(p.key));
}

// reset a pane's conversation when its target changes (but not while restoring saved selections)
watch(valueSingle, () => {
	if (hydrated.value) inference.clear(SINGLE_KEY);
	saveSel();
});
watch(valueA, () => {
	if (hydrated.value) inference.clear(A_KEY);
	saveSel();
});
watch(valueB, () => {
	if (hydrated.value) inference.clear(B_KEY);
	saveSel();
});

// readable label for a target value, used in the exported transcript and diff viewer
function labelFor(value: string): string {
	return options.value.find((o) => o.value === value)?.label ?? value;
}

function transcript(): string {
	return chatsToText(
		panes.value.map((p) => ({
			title: labelFor(p.valueRef.value),
			messages: inference.pathOf(p.key)
		})),
		{ title: 'Playground Conversation' }
	);
}
function copyAll() {
	exporter.copy(transcript());
}
function downloadAll() {
	exporter.download(transcript(), 'playground-conversation');
}

// collapse a path into [{ question, answer }] turns (compaction nodes skipped)
function turnsOf(path: PathNode[]): { q: string; a: string }[] {
	const turns: { q: string; a: string }[] = [];
	let q = '';
	for (const n of path) {
		if (n.compacted) continue;
		if (n.role === 'user') q = n.content;
		else if (n.role === 'assistant') {
			turns.push({ q, a: n.content });
			q = '';
		}
	}
	return turns;
}

// the two compare panes share the same questions; pair their answers by turn for the diff viewer
const diffPairs = computed(() => {
	const ta = turnsOf(inference.pathOf(A_KEY));
	const tb = turnsOf(inference.pathOf(B_KEY));
	const len = Math.max(ta.length, tb.length);
	const out: { question: string; a: string; b: string }[] = [];
	for (let i = 0; i < len; i++) {
		out.push({
			question: ta[i]?.q ?? tb[i]?.q ?? '',
			a: ta[i]?.a ?? '',
			b: tb[i]?.a ?? ''
		});
	}
	return out;
});

// only offer the diff once both compare panes have at least one answer
const canShowDiff = computed(
	() => mode.value === 'compare' && diffPairs.value.some((p) => p.a || p.b)
);

// edit-and-resend a user turn in a single pane: branch a new version, then re-run that pane
async function onEdit(
	paneKey: string,
	valueRef: { value: string },
	{ id, content }: { id: string; content: string }
) {
	if (inference.isLoading(paneKey)) return;
	const target = targetOf(valueRef.value);
	if (!target) return;
	await inference
		.editPlayground(paneKey, target, id, content, {
			maxTokens: maxTokens.value,
			system: systemPrompt.value.trim() || undefined
		})
		.catch(() => {});
}

function onBranch(paneKey: string, { id, dir }: { id: string; dir: number }) {
	inference.branch(paneKey, id, dir);
}

async function onSubmit() {
	const text = prompt.value.trim();
	if (!text) return;
	if (mode.value === 'compare' && !canCompare.value) return;
	if (panes.value.some((p) => inference.isLoading(p.key))) return;
	prompt.value = '';

	// fan the same user turn out to every active pane, each keeping its own history
	await Promise.all(
		panes.value.map((p) => {
			const target = targetOf(p.valueRef.value);
			if (!target) return Promise.resolve();
			return inference
				.sendPlayground(p.key, target, text, {
					maxTokens: maxTokens.value,
					system: systemPrompt.value.trim() || undefined
				})
				.catch(() => {});
		})
	);
}
</script>
