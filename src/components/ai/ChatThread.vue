<template>
	<div
		ref="scroller"
		class="scrollbar-hide flex flex-col gap-3 overflow-y-auto scroll-smooth"
	>
		<div
			v-if="!visible.length && !showThinking"
			class="py-8 text-center text-xs text-muted"
		>
			<slot name="empty">Send a prompt to start.</slot>
		</div>

		<template
			v-for="node in visible"
			:key="node.id"
		>
			<div
				v-if="node.compacted"
				class="flex flex-col items-center gap-1 py-1"
			>
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1 text-xs text-muted transition-colors hover:text-default"
					:title="node.content"
					@click="toggleSummary(node.id)"
				>
					<UIcon
						name="mdi:archive-arrow-down-outline"
						class="size-3.5 text-primary"
					/>
					Earlier Messages Summarized
					<UIcon
						:name="openSummary === node.id ? 'mdi:chevron-up' : 'mdi:chevron-down'"
						class="size-3.5"
					/>
				</button>
				<div
					v-if="openSummary === node.id"
					class="max-w-[90%] rounded-lg bg-elevated/60 px-3 py-2 text-xs whitespace-pre-wrap text-muted"
				>
					{{ node.content }}
				</div>
			</div>

			<div
				v-else
				class="group flex gap-2"
				:class="node.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
			>
				<div
					class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
					:class="
						node.role === 'user' ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary'
					"
				>
					<UIcon
						:name="node.role === 'user' ? 'mdi:account' : 'mdi:robot-happy-outline'"
						class="size-3.5"
					/>
				</div>

				<div
					class="flex max-w-[85%] flex-col gap-1"
					:class="node.role === 'user' ? 'items-end' : 'items-start'"
				>
					<!-- inline editor for resending an earlier user turn (creates a new branch) -->
					<div
						v-if="editingId === node.id"
						class="w-full rounded-lg border border-primary/40 bg-primary/5 p-2"
					>
						<UTextarea
							v-model="draft"
							:rows="2"
							autoresize
							class="w-full"
							:maxrows="8"
							@keydown.enter.exact.prevent="saveEdit(node.id)"
						/>
						<div class="mt-1.5 flex justify-end gap-1.5">
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								label="Cancel"
								@click="cancelEdit"
							/>
							<UButton
								size="xs"
								color="primary"
								icon="mdi:send"
								label="Save & Resend"
								:disabled="!draft.trim()"
								@click="saveEdit(node.id)"
							/>
						</div>
					</div>

					<template v-else>
						<div
							class="rounded-lg px-3 py-2 text-sm"
							:class="
								node.role === 'user' ? 'bg-primary/15 text-highlighted' : 'bg-elevated text-default'
							"
						>
							<div
								v-if="node.role === 'assistant'"
								class="prose prose-sm dark:prose-invert max-w-none wrap-break-word"
								v-html="render(node.content)"
							/>
							<p
								v-else
								class="whitespace-pre-wrap wrap-break-word"
							>
								{{ node.content }}
							</p>
						</div>

						<div
							class="flex items-center gap-0.5"
							:class="node.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
						>
							<div
								v-if="node.versions"
								class="flex items-center gap-0.5 text-xs text-muted"
							>
								<UButton
									icon="mdi:chevron-left"
									size="xs"
									variant="ghost"
									color="neutral"
									aria-label="Previous Version"
									:disabled="node.versions.index <= 1 || loading"
									@click="emit('branch', { id: node.id, dir: -1 })"
								/>
								<span class="tabular-nums"
									>{{ node.versions.index }}/{{ node.versions.count }}</span
								>
								<UButton
									icon="mdi:chevron-right"
									size="xs"
									variant="ghost"
									color="neutral"
									aria-label="Next Version"
									:disabled="node.versions.index >= node.versions.count || loading"
									@click="emit('branch', { id: node.id, dir: 1 })"
								/>
							</div>

							<!-- hover actions -->
							<div
								class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
							>
								<UTooltip :text="copiedId === node.id ? 'Copied' : 'Copy'">
									<UButton
										:icon="copiedId === node.id ? 'mdi:check' : 'mdi:content-copy'"
										size="xs"
										variant="ghost"
										color="neutral"
										:aria-label="copiedId === node.id ? 'Copied' : 'Copy Message'"
										@click="copy(node.content, node.id)"
									/>
								</UTooltip>
								<UTooltip
									v-if="editable && node.role === 'user' && !loading"
									text="Edit & Resend"
								>
									<UButton
										icon="mdi:pencil"
										size="xs"
										variant="ghost"
										color="neutral"
										aria-label="Edit Message"
										@click="startEdit(node.id, node.content)"
									/>
								</UTooltip>
							</div>
						</div>
					</template>
				</div>
			</div>
		</template>

		<!-- thinking indicator until the first token streams in -->
		<div
			v-if="showThinking"
			class="flex gap-2"
		>
			<div
				class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
			>
				<UIcon
					name="mdi:robot-happy-outline"
					class="size-3.5"
				/>
			</div>
			<div class="flex items-center gap-1.5 rounded-lg bg-elevated px-3 py-3">
				<span class="size-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
				<span class="size-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
				<span class="size-2 animate-bounce rounded-full bg-primary" />
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { PathNode } from '~/stores/inference';

const props = defineProps<{ nodes: PathNode[]; loading?: boolean; editable?: boolean }>();
const emit = defineEmits<{
	edit: [{ id: string; content: string }];
	branch: [{ id: string; dir: number }];
}>();

const { renderMarkdown } = useMarkdown();
function render(content: string) {
	return renderMarkdown(content || '');
}

// hide empty assistant placeholders; the thinking indicator stands in for them
const visible = computed(() => props.nodes.filter((n) => !(n.role === 'assistant' && !n.content)));

const showThinking = computed(() => {
	if (!props.loading) return false;
	const last = props.nodes[props.nodes.length - 1];
	return !(last?.role === 'assistant' && last.content);
});

const openSummary = ref<string | null>(null);
function toggleSummary(id: string) {
	openSummary.value = openSummary.value === id ? null : id;
}

const copiedId = ref<string | null>(null);
function copy(text: string, id: string) {
	if (!import.meta.client) return;
	navigator.clipboard.writeText(text);
	copiedId.value = id;
	setTimeout(() => (copiedId.value = null), 1500);
}

// edit-and-resend: load a user turn into an inline editor, emit on save (parent branches it)
const editingId = ref<string | null>(null);
const draft = ref('');
function startEdit(id: string, content: string) {
	editingId.value = id;
	draft.value = content;
}
function cancelEdit() {
	editingId.value = null;
	draft.value = '';
}
function saveEdit(id: string) {
	const content = draft.value.trim();
	if (!content) return;
	cancelEdit();
	emit('edit', { id, content });
}
// drop the editor if a new run starts
watch(
	() => props.loading,
	(l) => l && cancelEdit()
);

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
	() => [props.nodes.length, props.nodes[props.nodes.length - 1]?.content, props.loading],
	() => nextTick(() => toBottom(true))
);
onMounted(() => nextTick(() => toBottom(false)));
onBeforeUnmount(() => raf && cancelAnimationFrame(raf));
</script>
