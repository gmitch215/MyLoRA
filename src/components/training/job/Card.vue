<template>
	<div :class="['space-y-3 rounded-lg border p-4 bg-elevated/50', borderClass]">
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div class="min-w-0 space-y-1">
				<div class="flex flex-wrap items-center gap-2">
					<h3 class="truncate text-sm font-semibold text-highlighted">{{ title }}</h3>
					<UBadge
						color="neutral"
						variant="outline"
						size="sm"
					>
						{{ engineLabel }}
					</UBadge>
				</div>
				<p class="text-xs text-muted">{{ baseModelLabel }} - Rank {{ job.config.rank }}</p>
			</div>
			<TrainingJobStatusBadge :status="job.status" />
		</div>

		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
			<span
				v-if="timestamp"
				class="inline-flex items-center gap-1"
			>
				<UIcon
					name="mdi:clock-outline"
					class="size-3.5"
				/>
				{{ timestamp }}
			</span>
			<span
				v-if="timing"
				class="inline-flex items-center gap-1"
			>
				<UIcon
					name="mdi:timer-outline"
					class="size-3.5"
				/>
				{{ timing }}
			</span>
			<span
				v-if="job.attempt > 1"
				class="inline-flex items-center gap-1"
			>
				<UIcon
					name="mdi:repeat"
					class="size-3.5"
				/>
				Attempt {{ job.attempt }}
			</span>
			<span
				v-if="job.adapterSize"
				class="inline-flex items-center gap-1"
			>
				<UIcon
					name="mdi:weight"
					class="size-3.5"
				/>
				{{ formatBytes(job.adapterSize) }}
			</span>
		</div>

		<UAlert
			v-if="failed"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="failureTitleText"
			:description="job.statusMessage || 'The training job did not finish successfully.'"
		/>

		<TrainingJobLogTail
			v-if="expanded"
			:log-tail="job.logTail"
			:status-message="failed ? null : job.statusMessage"
		/>

		<div class="flex flex-wrap items-center gap-2 border-t border-default pt-3">
			<UButton
				size="xs"
				color="neutral"
				variant="outline"
				icon="mdi:open-in-new"
				@click="emit('open', job)"
			>
				Details
			</UButton>
			<UButton
				size="xs"
				color="neutral"
				variant="outline"
				:icon="expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'"
				@click="expanded = !expanded"
			>
				{{ expanded ? 'Hide Logs' : 'View Logs' }}
			</UButton>
			<UButton
				v-if="!terminal"
				size="xs"
				color="error"
				variant="outline"
				icon="mdi:stop"
				:loading="aborting"
				@click="onAbort"
			>
				Abort
			</UButton>
			<UButton
				v-if="retryable"
				size="xs"
				color="primary"
				variant="outline"
				icon="mdi:refresh"
				@click="emit('relaunch', job)"
			>
				Retry
			</UButton>

			<template v-if="downloadable">
				<UButton
					size="xs"
					color="success"
					variant="outline"
					icon="mdi:download"
					:to="`/api/training/jobs/${job.id}/artifact/weights`"
					external
					download
				>
					Download Weights
				</UButton>
				<UButton
					size="xs"
					color="secondary"
					variant="outline"
					icon="mdi:download"
					:to="`/api/training/jobs/${job.id}/artifact/config`"
					external
					download
				>
					Download Config
				</UButton>
				<span
					v-if="job.downloadOnly"
					class="text-xs text-muted"
					>Not Cloudflare-deployable - download only</span
				>
			</template>
			<span
				v-else-if="adapterDeleted"
				class="inline-flex items-center gap-1 text-xs text-warning"
			>
				<UIcon
					name="mdi:file-remove-outline"
					class="size-3.5"
				/>
				Adapter deleted - artifacts unavailable (log still viewable)
			</span>

			<UButton
				v-if="terminal"
				size="xs"
				color="error"
				variant="ghost"
				icon="mdi:trash-can-outline"
				@click="emit('delete', job)"
			>
				Delete
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ job: TrainingJobView }>();
const emit = defineEmits<{
	relaunch: [job: TrainingJobView];
	open: [job: TrainingJobView];
	delete: [job: TrainingJobView];
}>();

const store = useTrainingJobsStore();
const toast = useToast();

const aborting = ref(false);

const terminal = computed(() => isTerminalJob(props.job.status));
const failed = computed(() => isFailedJob(props.job.status));
// border accent reflects state: error when failed, info while in flight, neutral otherwise
const borderClass = computed(() =>
	failed.value ? 'border-error' : !terminal.value ? 'border-info' : 'border-default'
);
// failed/abnormal/aborted can be relaunched
const retryable = computed(() => failed.value || props.job.status === 'aborted');
// any completed job can download its config + weights (download-only from the job, CF-deployable from
// the promoted adapter copy - the artifact endpoint resolves either)
const downloadable = computed(
	() => props.job.status === 'completed' && (props.job.downloadOnly || !!props.job.adapterId)
);
// a completed CF-deployable job with a now-null adapterId = its adapter was deleted (FK set-null);
// artifacts are gone but the log survives
const adapterDeleted = computed(
	() => props.job.status === 'completed' && !props.job.downloadOnly && !props.job.adapterId
);

const title = computed(() => props.job.machineLabel || 'Training Job');
const ENGINE_LABELS: Record<TrainingEngine, string> = {
	doc2lora: 'doc2lora',
	peft: 'PEFT',
	accelerate: 'Accelerate'
};
const engineLabel = computed(() => ENGINE_LABELS[props.job.engine] ?? props.job.engine);

// surface preflight detail immediately on a failed job
const expanded = ref(isFailedJob(props.job.status));
watch(
	() => props.job.status,
	(s) => {
		if (isFailedJob(s)) expanded.value = true;
	}
);
const baseModelLabel = computed(() => {
	const m = props.job.config.baseModel;
	return m.split('/').pop() || m;
});

// pre-training phase (deps install / base-model download) from the live tail; hold the eta until the
// loop actually steps so the countdown does not burn down during the model download
const phase = computed(() => trainingPhase(props.job.logTail));
const preTraining = computed(() => !terminal.value && phase.value !== 'training');

// eta while in flight; elapsed once finished (or running with a known start)
const timing = computed(() => {
	// not training yet: show the phase, never the training countdown
	if (preTraining.value)
		return phase.value === 'loading' ? 'Downloading model...' : 'Installing deps...';
	if (!terminal.value && props.job.etaSeconds) return `ETA ${formatDuration(props.job.etaSeconds)}`;
	if (props.job.startedAt) {
		const end = props.job.finishedAt ? new Date(props.job.finishedAt) : new Date();
		const secs = (end.getTime() - new Date(props.job.startedAt).getTime()) / 1000;
		if (secs > 0) return `${terminal.value ? 'Took' : 'Elapsed'} ${formatDuration(secs)}`;
	}
	return '';
});

// absolute wall-clock stamp for the state we are in (finished > started > created)
const timestamp = computed(() => {
	const iso = terminal.value
		? props.job.finishedAt || props.job.startedAt || props.job.createdAt
		: props.job.startedAt || props.job.createdAt;
	return iso ? formatDateTime(iso) : '';
});

const failureTitleText = computed(() => failureTitle(props.job.failureClass));

async function onAbort() {
	aborting.value = true;
	try {
		await store.abort(props.job.id);
		toast.add({ title: 'Job aborted', color: 'neutral', icon: 'mdi:cancel' });
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Abort failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		aborting.value = false;
	}
}
</script>
