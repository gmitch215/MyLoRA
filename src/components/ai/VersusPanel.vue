<template>
	<div class="flex flex-col gap-4">
		<p class="text-xs text-muted">
			Two agents talk to each other. Pick who speaks first, give each a stance, and set how many
			messages each one writes.
		</p>

		<div class="grid gap-3 sm:grid-cols-2">
			<div
				v-for="side in SIDES"
				:key="side"
				class="flex min-w-0 flex-col gap-2 rounded-lg border border-default bg-elevated/50 p-3"
			>
				<div class="flex items-center gap-2">
					<span
						class="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
						:class="side === 'a' ? 'bg-primary/15 text-primary' : 'bg-secondary/15 text-secondary'"
					>
						{{ side === 'a' ? 'A' : 'B' }}
					</span>
					<span class="text-xs font-medium text-highlighted">
						{{ side === 'a' ? 'Agent A' : 'Agent B' }}
					</span>
					<UBadge
						v-if="first === side"
						size="sm"
						color="primary"
						variant="subtle"
						label="Speaks First"
						class="ml-auto"
					/>
					<UButton
						v-else
						size="xs"
						variant="link"
						color="neutral"
						class="ml-auto px-0"
						@click="first = side"
					>
						Speak First
					</UButton>
				</div>

				<USelectMenu
					:model-value="targetValue[side]"
					:items="options"
					value-key="value"
					placeholder="Select a base model or LoRA adapter"
					:aria-label="side === 'a' ? 'Agent A Target' : 'Agent B Target'"
					class="w-full"
					@update:model-value="targetValue[side] = $event"
				/>

				<UTextarea
					v-if="maxSystemChars > 0"
					v-model="persona[side]"
					:rows="3"
					:maxlength="maxSystemChars"
					:disabled="running"
					:aria-label="side === 'a' ? 'Agent A Persona' : 'Agent B Persona'"
					placeholder="Optional persona for this side..."
					class="w-full"
				/>
			</div>
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<UFormField
				label="Stance"
				class="min-w-44 flex-1"
			>
				<USelectMenu
					v-model="presetId"
					:items="presetItems"
					value-key="value"
					:disabled="running"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Messages Each"
				:help="`${minMessages}-${maxMessages}`"
			>
				<UInput
					v-model.number="perAgent"
					type="number"
					:min="minMessages"
					:max="maxMessages"
					:disabled="running"
					class="w-28"
				/>
			</UFormField>
			<UFormField label="Max Tokens">
				<UInput
					v-model.number="maxTokens"
					type="number"
					:min="16"
					:max="maxTokenCeiling"
					:disabled="running"
					class="w-28"
				/>
			</UFormField>
		</div>

		<UFormField
			label="Topic"
			help="The opening prompt both agents are given."
		>
			<UTextarea
				v-model="topic"
				:rows="2"
				:disabled="running"
				placeholder="What should they talk about?"
				class="w-full"
			/>
		</UFormField>

		<div class="flex flex-wrap items-center gap-2">
			<UButton
				v-if="!running"
				icon="mdi:sword-cross"
				color="primary"
				:disabled="!canStart"
				@click="start"
			>
				Start Match
			</UButton>
			<UButton
				v-else
				icon="mdi:stop"
				color="error"
				variant="soft"
				@click="inference.stopVersus()"
			>
				Stop
			</UButton>

			<span
				v-if="state.total"
				class="text-xs text-muted tabular-nums"
			>
				Message {{ Math.min(state.turn, state.total) }} of {{ state.total }}
			</span>

			<template v-if="state.messages.length">
				<UTooltip :text="exporter.copied.value ? 'Copied' : 'Copy Transcript'">
					<UButton
						:icon="exporter.copied.value ? 'mdi:check' : 'mdi:content-copy'"
						size="sm"
						variant="ghost"
						color="neutral"
						aria-label="Copy Transcript"
						class="ml-auto"
						@click="exporter.copy(transcript())"
					/>
				</UTooltip>
				<UTooltip text="Download Transcript">
					<UButton
						icon="mdi:download"
						size="sm"
						variant="ghost"
						color="neutral"
						aria-label="Download Transcript"
						@click="exporter.download(transcript(), 'versus-match')"
					/>
				</UTooltip>
				<UButton
					size="sm"
					icon="mdi:broom"
					variant="ghost"
					color="neutral"
					:disabled="running"
					@click="inference.clearVersus()"
				>
					Clear
				</UButton>
			</template>
		</div>

		<UAlert
			v-if="!canCompareTargets && !running"
			color="warning"
			variant="subtle"
			icon="mdi:alert"
			title="Pick a Target for Both Agents"
		/>

		<AiContextMeter
			v-if="state.messages.length"
			:used="usedTokens"
			:total="contextTotal"
		/>

		<AiVersusThread
			:messages="state.messages"
			:labels="threadLabels"
			:topic="state.topic"
			:running="running"
			class="min-h-[36vh] max-h-[60vh] rounded-lg border border-default bg-default/60 p-3"
		/>

		<UAlert
			v-if="state.error"
			:color="state.stopped === 'limit' ? 'warning' : 'error'"
			variant="subtle"
			:icon="state.stopped === 'limit' ? 'mdi:timer-sand' : 'mdi:alert-circle'"
			:title="state.stopped === 'limit' ? 'Match Stopped by the Rate Limit' : 'Match Failed'"
			:description="limitDescription"
		/>
		<UAlert
			v-else-if="state.stopped === 'user'"
			color="neutral"
			variant="subtle"
			icon="mdi:stop-circle-outline"
			title="Match Stopped"
			description="The partial transcript above is kept."
		/>
	</div>
</template>

<script setup lang="ts">
import type { VersusSide } from '#shared/versus';

const SIDES: VersusSide[] = ['a', 'b'];
const SEL_KEY = 'mylora:versus:setup:v1';

const inference = useInferenceStore();
const settings = useSettingsStore();
const { limits } = storeToRefs(settings);
const targets = usePlaygroundTargets();
const { options } = targets;
const exporter = useChatExport();

const state = computed(() => inference.versus);
const running = computed(() => state.value.running);

const maxTokenCeiling = computed(() => limits.value.maxOutputTokens);
const maxSystemChars = computed(() => limits.value.maxSystemPromptChars);
const minMessages = computed(() =>
	clampVersusMessages(
		limits.value.versusMinMessages,
		limits.value.versusMinMessages,
		limits.value.versusMaxMessages
	)
);
const maxMessages = computed(() =>
	clampVersusMessages(
		limits.value.versusMaxMessages,
		limits.value.versusMinMessages,
		limits.value.versusMaxMessages
	)
);

const maxTokens = ref(maxTokenCeiling.value);
const perAgent = ref(DEFAULT_VERSUS_MESSAGES);
const first = ref<VersusSide>('a');
const topic = ref('');
const presetId = ref(DEFAULT_VERSUS_PRESET);
const persona = reactive<Record<VersusSide, string>>({ a: '', b: '' });
const targetValue = reactive<Record<VersusSide, string>>({ a: '', b: '' });

const presetItems = computed(() =>
	VERSUS_PRESETS.map((p) => ({ label: `${p.label} - ${p.description}`, value: p.id }))
);

watch(maxTokenCeiling, (ceil) => {
	if (maxTokens.value > ceil) maxTokens.value = ceil;
});
// immediate: an admin range that excludes the default must pull the control in on first render,
// not only when the range later changes
watch(
	[minMessages, maxMessages],
	() => {
		perAgent.value = clampVersusMessages(perAgent.value, minMessages.value, maxMessages.value);
	},
	{ immediate: true }
);

// applying a preset overwrites both personas; freeform leaves whatever is typed
watch(presetId, (id) => {
	const preset = versusPreset(id);
	if (!preset || preset.id === 'freeform') return;
	persona.a = preset.personaA;
	persona.b = preset.personaB;
});

const canCompareTargets = computed(() => !!targetValue.a && !!targetValue.b);
const canStart = computed(
	() => canCompareTargets.value && !!topic.value.trim() && !running.value && perAgent.value >= 1
);

const threadLabels = computed(() => ({
	a: state.value.labels.a || targets.labelFor(targetValue.a),
	b: state.value.labels.b || targets.labelFor(targetValue.b)
}));

const usedTokens = computed(() =>
	estimateTokens(
		[state.value.topic, ...state.value.messages.map((m) => m.content)].filter(Boolean).join('\n')
	)
);
// a run is bounded by whichever side has the smaller window
const contextTotal = computed(() =>
	Math.min(
		targets.contextFor(targetValue.a) || DEFAULT_CONTEXT_WINDOW,
		targets.contextFor(targetValue.b) || DEFAULT_CONTEXT_WINDOW
	)
);

const limitDescription = computed(() => {
	if (state.value.stopped !== 'limit') return state.value.error ?? '';
	const retry = state.value.retryAfter;
	const wait = retry ? ` Try again in about ${Math.ceil(retry / 60)} minute(s).` : '';
	return `${state.value.error ?? 'Rate limit reached'}.${wait} The partial transcript above is kept.`;
});

function transcript(): string {
	return chatsToText(
		SIDES.map((side) => ({
			title: threadLabels.value[side],
			messages: state.value.messages
				.filter((m) => m.side === side)
				.map((m) => ({ role: 'assistant' as const, content: m.content }))
		})),
		{ title: `Versus: ${state.value.topic}` }
	);
}

function saveSetup() {
	if (!import.meta.client) return;
	try {
		localStorage.setItem(
			SEL_KEY,
			JSON.stringify({
				a: targetValue.a,
				b: targetValue.b,
				first: first.value,
				perAgent: perAgent.value,
				presetId: presetId.value,
				topic: topic.value
			})
		);
	} catch {
		// best-effort
	}
}

async function start() {
	if (!canStart.value) return;
	const a = targets.targetOf(targetValue.a);
	const b = targets.targetOf(targetValue.b);
	if (!a || !b) return;
	saveSetup();
	await inference
		.runVersus({
			topic: topic.value.trim(),
			first: first.value,
			perAgent: clampVersusMessages(perAgent.value, minMessages.value, maxMessages.value),
			maxTokens: maxTokens.value,
			maxSystemChars: maxSystemChars.value,
			a: { target: a, persona: persona.a, label: targets.labelFor(targetValue.a) },
			b: { target: b, persona: persona.b, label: targets.labelFor(targetValue.b) }
		})
		.catch(() => {});
}

onMounted(async () => {
	inference.hydrateVersus();
	await targets.load();

	// defaults: adapter vs its own base model, else the first two base models
	const firstAdapter = targets.adapters.value[0];
	const firstBase = targets.models.value[0]?.model;
	targetValue.a = firstAdapter
		? `adapter:${firstAdapter.id}`
		: firstBase
			? `base:${firstBase}`
			: '';
	targetValue.b = firstAdapter
		? `base:${firstAdapter.baseModel}`
		: targets.models.value[1]?.model
			? `base:${targets.models.value[1]!.model}`
			: targetValue.a;

	const preset = versusPreset(presetId.value);
	if (preset && preset.id !== 'freeform') {
		persona.a = preset.personaA;
		persona.b = preset.personaB;
	}

	const valid = new Set(options.value.map((o) => o.value));
	try {
		const saved = JSON.parse(localStorage.getItem(SEL_KEY) || 'null');
		if (saved) {
			if (valid.has(saved.a)) targetValue.a = saved.a;
			if (valid.has(saved.b)) targetValue.b = saved.b;
			if (saved.first === 'a' || saved.first === 'b') first.value = saved.first;
			if (typeof saved.perAgent === 'number') {
				perAgent.value = clampVersusMessages(saved.perAgent, minMessages.value, maxMessages.value);
			}
			if (versusPreset(saved.presetId)) presetId.value = saved.presetId;
			if (typeof saved.topic === 'string') topic.value = saved.topic;
		}
	} catch {
		// ignore malformed persisted state
	}
});
</script>
