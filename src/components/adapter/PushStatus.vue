<template>
	<div
		v-if="compact"
		class="space-y-1"
	>
		<div class="flex items-center gap-2">
			<AppSpinner
				v-if="isPushing"
				size="sm"
				class="size-3.5! text-primary shrink-0"
			/>
			<UIcon
				v-else
				:name="pushIcon"
				:class="pushIconClass"
				class="size-3.5 shrink-0"
			/>
			<span
				class="text-xs"
				:class="isError ? 'text-error' : 'text-muted'"
				>{{ phaseLabel }}</span
			>
		</div>
		<UProgress
			v-if="showProgress"
			:model-value="isDone ? 100 : isPushing ? undefined : 0"
			:max="100"
			:color="isDone ? 'success' : 'primary'"
			:animation="isPushing ? 'carousel' : undefined"
			size="xs"
		/>
		<p
			v-if="isError && (statusMessage || job?.error)"
			class="text-xs text-error"
		>
			{{ statusMessage || job?.error }}
		</p>
	</div>

	<div
		v-else
		class="space-y-4"
	>
		<div class="flex items-center gap-3">
			<UIcon
				:name="r2Done ? 'mdi:check-circle' : 'mdi:circle-outline'"
				:class="r2Done ? 'text-success' : 'text-muted'"
				class="size-5 shrink-0"
			/>
			<div>
				<p class="text-sm font-medium text-highlighted">Uploaded to storage (R2)</p>
				<p class="text-xs text-muted">Config and weights stored; adapter is downloadable.</p>
			</div>
		</div>

		<div class="rounded border border-default p-3 space-y-3 bg-elevated/30">
			<div class="flex items-center gap-3">
				<AppSpinner
					v-if="isPushing"
					size="lg"
					class="size-5! text-primary shrink-0"
				/>
				<UIcon
					v-else
					:name="pushIcon"
					:class="pushIconClass"
					class="size-5 shrink-0"
				/>
				<div class="flex-1">
					<p class="text-sm font-medium text-highlighted">Pushing to Cloudflare Finetune Catalog</p>
					<p class="text-xs text-muted">{{ phaseLabel }}</p>
				</div>
			</div>

			<UProgress
				v-if="showProgress"
				:model-value="isDone ? 100 : isPushing ? undefined : 0"
				:max="100"
				:color="isDone ? 'success' : 'primary'"
				:animation="isPushing ? 'carousel' : undefined"
				size="sm"
			/>

			<p
				v-if="statusMessage && !isError"
				class="text-xs text-muted"
			>
				{{ statusMessage }}
			</p>
		</div>

		<UAlert
			v-if="isError"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			title="Publish Failed"
			:description="statusMessage || job?.error || 'The push to Cloudflare failed.'"
		>
			<template #actions>
				<slot name="retry">
					<UButton
						color="error"
						variant="outline"
						size="xs"
						icon="mdi:refresh"
						@click="emit('retry')"
					>
						Retry
					</UButton>
				</slot>
			</template>
		</UAlert>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{
	job: PushJob | null;
	status: AdapterStatus;
	statusMessage?: string | null;
	compact?: boolean;
}>();

const emit = defineEmits<{ retry: [] }>();

// phase a is done once the adapter moved past draft
const r2Done = computed(() => props.status !== 'draft');

// single source of truth: the db status decides; the kv job only refines the pushing sub-phase.
// deriving one view prevents contradictory states (e.g. done bar + failed alert at once)
type View = 'idle' | 'pushing' | 'done' | 'error';
const view = computed<View>(() => {
	if (props.status === 'published') return 'done';
	if (props.status === 'failed') return 'error';
	if (props.status === 'pushing') return 'pushing';
	// no decisive status yet: fall back to the job phase
	if (props.job?.phase === 'done') return 'done';
	if (props.job?.phase === 'error') return 'error';
	if (props.job) return 'pushing';
	return 'idle';
});

const isError = computed(() => view.value === 'error');
const isDone = computed(() => view.value === 'done');
const isPushing = computed(() => view.value === 'pushing');

const showProgress = computed(() => isPushing.value || isDone.value);

const PHASE_LABELS: Record<PushJob['phase'], string> = {
	create: 'Creating finetune...',
	config: 'Uploading config...',
	weights: 'Uploading weights...',
	done: 'Published and testable.',
	error: 'Push failed.'
};

const phaseLabel = computed(() => {
	if (view.value === 'done') return 'Published and testable.';
	if (view.value === 'error') return 'Push failed.';
	if (view.value === 'pushing') {
		const p = props.job?.phase;
		return p && p !== 'done' && p !== 'error' ? PHASE_LABELS[p] : 'Starting push...';
	}
	if (props.status === 'listed') return 'Listed; not yet pushed to Cloudflare.';
	return 'Waiting.';
});

const pushIcon = computed(() => {
	if (isError.value) return 'mdi:alert-circle';
	if (isDone.value) return 'mdi:check-circle';
	if (isPushing.value) return 'i-lucide-loader-circle';
	return 'mdi:circle-outline';
});

const pushIconClass = computed(() => {
	if (isError.value) return 'text-error';
	if (isDone.value) return 'text-success';
	if (isPushing.value) return 'text-primary animate-spin';
	return 'text-muted';
});
</script>
