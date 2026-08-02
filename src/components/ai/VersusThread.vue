<template>
	<div
		ref="scroller"
		role="log"
		aria-live="polite"
		aria-label="Versus Transcript"
		class="scrollbar-hide flex flex-col gap-3 overflow-y-auto scroll-smooth"
	>
		<div
			v-if="topic"
			class="mx-auto max-w-[92%] rounded-lg border border-dashed border-default bg-elevated/40 px-3 py-2 text-center text-xs text-muted"
		>
			<span class="font-medium text-highlighted">Topic</span>
			<p class="mt-0.5 whitespace-pre-wrap wrap-break-word">{{ topic }}</p>
		</div>

		<div
			v-if="!messages.length && !showThinking"
			class="py-8 text-center text-xs text-muted"
		>
			<slot name="empty">Pick two targets and start the match.</slot>
		</div>

		<div
			v-for="(message, index) in messages"
			:key="message.id"
			class="group flex gap-2"
			:class="message.side === 'b' ? 'flex-row-reverse' : 'flex-row'"
		>
			<div
				class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
				:class="
					message.side === 'a' ? 'bg-primary/15 text-primary' : 'bg-secondary/15 text-secondary'
				"
			>
				{{ message.side === 'a' ? 'A' : 'B' }}
			</div>

			<div
				class="flex min-w-0 max-w-[85%] flex-col gap-1"
				:class="message.side === 'b' ? 'items-end' : 'items-start'"
			>
				<span class="max-w-full truncate px-1 text-[11px] text-dimmed">
					{{ labelFor(message.side) }}
				</span>

				<div
					class="rounded-lg px-3 py-2 text-sm"
					:class="
						message.side === 'a' ? 'bg-primary/10 text-default' : 'bg-secondary/10 text-default'
					"
				>
					<div
						v-if="message.content"
						class="prose prose-sm dark:prose-invert max-w-none wrap-break-word"
						v-html="render(message.content)"
					/>
					<div
						v-else
						class="flex items-center gap-1.5 py-1"
					>
						<span class="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
						<span class="size-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
						<span class="size-2 animate-bounce rounded-full bg-current" />
					</div>
				</div>

				<div
					class="flex items-center gap-1 text-[11px] text-dimmed"
					:class="message.side === 'b' ? 'flex-row-reverse' : 'flex-row'"
				>
					<span class="tabular-nums">#{{ index + 1 }}</span>
					<UTooltip :text="copiedId === message.id ? 'Copied' : 'Copy'">
						<UButton
							:icon="copiedId === message.id ? 'mdi:check' : 'mdi:content-copy'"
							size="xs"
							variant="ghost"
							color="neutral"
							:aria-label="copiedId === message.id ? 'Copied' : 'Copy Message'"
							class="hover-reveal"
							@click="copy(message.content, message.id)"
						/>
					</UTooltip>
				</div>
			</div>
		</div>

		<div
			v-if="showThinking"
			class="py-2 text-center text-xs text-muted"
		>
			Waiting for the next reply...
		</div>
	</div>
</template>

<script setup lang="ts">
import type { VersusSide } from '#shared/versus';
import type { VersusMessage } from '~/stores/inference';

const props = defineProps<{
	messages: VersusMessage[];
	labels: { a: string; b: string };
	topic?: string;
	running?: boolean;
}>();

const { renderMarkdown } = useMarkdown();
function render(content: string) {
	return renderMarkdown(content || '');
}

function labelFor(side: VersusSide) {
	return (side === 'a' ? props.labels.a : props.labels.b) || (side === 'a' ? 'Agent A' : 'Agent B');
}

// the per-message placeholder already animates; this only covers the gap between turns
const showThinking = computed(
	() => !!props.running && !!props.messages[props.messages.length - 1]?.content
);

const copiedId = ref<string | null>(null);
function copy(text: string, id: string) {
	if (!import.meta.client || !text) return;
	navigator.clipboard.writeText(text);
	copiedId.value = id;
	setTimeout(() => (copiedId.value = null), 1500);
}

// keep the view pinned to the newest content as tokens stream in; only follow when the user is
// already near the bottom, and coalesce rapid token updates into one smooth scroll per frame
const scroller = ref<HTMLElement | null>(null);
let raf = 0;
function toBottom(smooth = true) {
	const el = scroller.value;
	if (!el) return;
	const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
	if (!nearBottom) return;
	if (raf) cancelAnimationFrame(raf);
	raf = requestAnimationFrame(() => {
		el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
	});
}
watch(
	() => [props.messages.length, props.messages[props.messages.length - 1]?.content, props.running],
	() => nextTick(() => toBottom(true))
);
onMounted(() => nextTick(() => toBottom(false)));
onBeforeUnmount(() => raf && cancelAnimationFrame(raf));
</script>
