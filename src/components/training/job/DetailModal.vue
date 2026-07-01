<template>
	<UModal
		:open="open"
		:title="headerTitle"
		:class="fullscreen ? 'w-screen h-screen max-w-none! max-h-none!' : 'max-w-4xl w-full'"
		@update:open="onOpenChange"
	>
		<template #header>
			<div class="flex w-full items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-2">
					<h3 class="truncate text-lg font-semibold text-highlighted">{{ headerTitle }}</h3>
					<UBadge
						color="neutral"
						variant="outline"
						size="sm"
						>{{ engineLabel }}</UBadge
					>
					<TrainingJobStatusBadge
						v-if="job"
						:status="job.status"
					/>
				</div>
				<div class="flex shrink-0 space-x-2">
					<UButton
						:icon="fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'"
						color="neutral"
						variant="ghost"
						:title="fullscreen ? 'Exit Fullscreen' : 'Fullscreen'"
						aria-label="Toggle Fullscreen"
						@click="fullscreen = !fullscreen"
					/>
					<UButton
						icon="mdi:close"
						color="neutral"
						variant="ghost"
						title="Close"
						aria-label="Close"
						@click="close"
					/>
				</div>
			</div>
		</template>

		<template #body>
			<div
				v-if="job"
				class="space-y-5"
			>
				<!-- progress + live eta countdown -->
				<div class="space-y-3 rounded-lg border border-default p-4 bg-elevated/50">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="text-sm font-semibold text-highlighted">{{ progressHeadline }}</span>
						<span class="font-mono text-xs text-muted">{{ phaseLabel }}</span>
					</div>

					<!-- surface the live status (provisioning detail, transient issues) during a run -->
					<p
						v-if="running && job.statusMessage"
						class="text-xs text-muted"
					>
						{{ job.statusMessage }}
					</p>
					<!-- during setup there is no training progress yet; say so instead of faking a countdown -->
					<p
						v-else-if="preparing"
						class="text-xs text-muted"
					>
						Downloading and installing the training stack on the machine. The first run on a fresh
						machine can take several minutes before training begins.
					</p>

					<div
						v-if="showProgressBar"
						class="space-y-1"
					>
						<UProgress
							v-if="percent != null"
							:model-value="percent"
							:max="100"
						/>
						<UProgress
							v-else
							animation="carousel"
						/>
						<div class="flex flex-wrap items-center justify-between gap-x-4 text-xs text-muted">
							<span v-if="percent != null">{{ percent }}%</span>
							<span v-if="stepLabel">{{ stepLabel }}</span>
							<span v-if="epochLabel">{{ epochLabel }}</span>
							<span
								v-if="rate"
								class="font-mono"
								>{{ rate }}</span
							>
						</div>
					</div>

					<!-- pre-training (deps install / base-model download): no real step yet, so show a plain
						spinner + label and NEVER a shrinking training countdown -->
					<div
						v-if="preTraining"
						class="flex items-center gap-2 text-sm font-medium text-highlighted"
					>
						<AppSpinner
							size="sm"
							class="text-primary shrink-0"
						/>
						{{ preTrainingLabel }}
					</div>
					<div
						v-else
						class="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm"
					>
						<span
							v-if="elapsedLabel"
							class="inline-flex items-center gap-1.5 text-muted"
						>
							<UIcon
								name="mdi:timer-outline"
								class="size-4"
							/>
							Elapsed {{ elapsedLabel }}
						</span>
						<!-- running + on track: countdown -->
						<span
							v-if="running && !overtime && etaLabel"
							class="inline-flex items-center gap-1.5 font-medium text-highlighted"
						>
							<UIcon
								name="mdi:timer-sand"
								class="size-4 text-primary"
							/>
							{{ etaLabel }} Remaining
						</span>
						<!-- running past the estimate: overtime warning -->
						<span
							v-else-if="running && overtime"
							class="inline-flex items-center gap-1.5 font-medium text-warning"
						>
							<UIcon
								name="mdi:timer-alert-outline"
								class="size-4"
							/>
							Running Over The Estimate
						</span>
						<!-- finished: how it compared to the estimate -->
						<span
							v-else-if="finishedNote"
							class="inline-flex items-center gap-1.5 font-medium text-info"
						>
							<UIcon
								name="mdi:timer-check-outline"
								class="size-4"
							/>
							{{ finishedNote }}
						</span>
					</div>
				</div>

				<!-- live machine telemetry (probe-supplied, only while running) -->
				<div
					v-if="job.telemetry && running && telemetryStats.length"
					class="space-y-3 rounded-lg border border-default p-4 bg-elevated/50"
				>
					<span class="text-sm font-semibold text-highlighted">Machine Telemetry</span>
					<div class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
						<div
							v-for="stat in telemetryStats"
							:key="stat.label"
							class="min-w-0"
						>
							<div class="flex items-center gap-1.5 text-xs text-muted">
								<UIcon
									v-if="stat.icon"
									:name="stat.icon"
									class="size-3.5"
								/>
								{{ stat.label }}
							</div>
							<div
								class="truncate font-medium"
								:class="stat.color || 'text-highlighted'"
							>
								{{ stat.value }}
							</div>
						</div>
					</div>
				</div>

				<!-- completion summary (terminal jobs only; aborted runs keep the plain log view) -->
				<div
					v-if="showSummary"
					class="space-y-3 rounded-lg border border-default p-4 bg-elevated/50"
				>
					<span class="text-sm font-semibold text-highlighted">{{
						isCompleted ? 'Completion Summary' : 'Run Summary'
					}}</span>

					<!-- output adapter name + slug (label stacked above value so long values do not gap) -->
					<div class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
						<div class="flex min-w-0 flex-col gap-0.5">
							<span class="text-xs text-muted">Adapter Name</span>
							<span
								class="truncate font-medium"
								:class="outputNameMuted ? 'text-muted italic' : 'text-toned'"
								>{{ outputNameLabel }}</span
							>
						</div>
						<div class="flex min-w-0 flex-col gap-0.5">
							<span class="text-xs text-muted">Adapter Slug</span>
							<span
								class="truncate font-mono font-medium"
								:class="outputSlugMuted ? 'text-muted italic' : 'text-toned'"
								>{{ outputSlugLabel }}</span
							>
						</div>
					</div>

					<!-- exact completion time + raw seconds + absolute finish timestamp -->
					<div
						v-if="exactElapsedSecs != null"
						class="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-default pt-3 text-sm"
					>
						<span class="inline-flex items-center gap-1.5 text-muted">
							<UIcon
								name="mdi:timer-outline"
								class="size-4"
							/>
							Took {{ formatDuration(exactElapsedSecs) }}
							<span class="font-mono text-xs">({{ exactElapsedSecs }}s)</span>
						</span>
						<span
							v-if="finishedAtLabel"
							class="inline-flex items-center gap-1.5 text-muted"
						>
							<UIcon
								name="mdi:timer-check-outline"
								class="size-4 text-info"
							/>
							Finished {{ finishedAtLabel }}
						</span>
					</div>

					<!-- full metric graphs (inline svg; no external chart lib - csp blocks them) -->
					<div
						v-if="hasSeries"
						class="grid gap-x-6 gap-y-5 border-t border-default pt-3 sm:grid-cols-2"
					>
						<TrainingJobMetricChart
							:points="lossChartPoints"
							title="Loss"
							x-label="Epoch"
							y-label="Loss"
							color="text-primary"
							:final-label="finalLossLabel"
							:legend="lossLegend"
						/>
						<TrainingJobMetricChart
							v-if="hasGradNorm"
							:points="gradNormChartPoints"
							title="Grad Norm"
							x-label="Epoch"
							y-label="Grad Norm"
							color="text-error"
							:final-label="finalGradNormLabel"
							:legend="gradNormLegend"
						/>
						<TrainingJobMetricChart
							:points="lrChartPoints"
							title="Learning Rate"
							x-label="Epoch"
							y-label="LR"
							color="text-warning"
							:y-format="lrFormat"
							:final-label="finalLrLabel"
							:legend="lrLegend"
						/>
						<TrainingJobMetricChart
							:points="epochChartPoints"
							title="Epoch"
							x-label="Step"
							y-label="Epoch"
							color="text-info"
							:final-label="finalEpochLabel"
							:legend="epochLegend"
						/>
					</div>
					<p
						v-else
						class="border-t border-default pt-3 text-xs text-muted"
					>
						No training-step metrics were logged.
					</p>

					<!-- final trainer throughput summary -->
					<div
						v-if="series.summary"
						class="space-y-2 border-t border-default pt-3"
					>
						<span class="text-xs font-medium text-muted">Training Throughput</span>
						<div class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
							<div
								v-for="stat in summaryStats"
								:key="stat.label"
								class="min-w-0"
							>
								<div class="text-xs text-muted">{{ stat.label }}</div>
								<div class="truncate font-medium text-highlighted">{{ stat.value }}</div>
							</div>
						</div>
					</div>

					<!-- phase timing breakdown (install vs scan vs training) -->
					<div
						v-if="phaseTimings.length"
						class="space-y-2 border-t border-default pt-3"
					>
						<span class="text-xs font-medium text-muted">Phase Timings</span>
						<div
							v-for="ph in phaseTimings"
							:key="ph.label"
							class="space-y-1"
						>
							<div class="flex items-center justify-between text-xs">
								<span class="text-toned">{{ ph.label }}</span>
								<span class="font-mono text-muted">{{ formatDuration(ph.seconds) }}</span>
							</div>
							<div class="h-1.5 overflow-hidden rounded-full bg-default">
								<div
									class="h-full rounded-full bg-primary"
									:style="{
										width: `${maxPhaseSeconds ? (ph.seconds / maxPhaseSeconds) * 100 : 0}%`
									}"
								/>
							</div>
						</div>
					</div>

					<!-- bandwidth the run itself consumed (current cumulative counter - first-sample baseline) -->
					<div
						v-if="bandwidthUsed"
						class="border-t border-default pt-3"
					>
						<div class="flex items-center gap-1.5 text-xs text-muted">
							<UIcon
								name="mdi:swap-vertical"
								class="size-3.5"
							/>
							Bandwidth Used
						</div>
						<div class="font-medium text-highlighted">
							RX {{ bandwidthUsed.rx }} / TX {{ bandwidthUsed.tx }}
						</div>
						<p class="text-xs text-muted">
							RX is data received (downloaded to the box, like the base model and dependencies); TX
							is data transmitted (uploaded from the box).
						</p>
						<p class="text-xs text-muted">This run's own consumption.</p>
					</div>
				</div>

				<!-- failure surface -->
				<UAlert
					v-if="failed"
					color="error"
					variant="subtle"
					icon="mdi:alert-circle"
					:title="failureTitleText"
					:description="job.statusMessage || 'The training job did not finish successfully.'"
				/>
				<UAlert
					v-else-if="job.statusMessage && !running"
					color="neutral"
					variant="subtle"
					icon="mdi:information-outline"
					:title="job.statusMessage"
				/>

				<div class="space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<h4 class="text-sm font-semibold text-highlighted">Training Log</h4>
						<div class="flex items-center gap-2">
							<USwitch
								v-if="running"
								v-model="follow"
								size="sm"
								label="Follow"
							/>
							<UButton
								size="xs"
								color="neutral"
								variant="outline"
								icon="mdi:download"
								:to="`/api/training/jobs/${job.id}/log?download=1`"
								external
								download
							>
								Download Logs
							</UButton>
						</div>
					</div>
					<div
						ref="logEl"
						class="scrollbar-hide overflow-auto rounded border border-default bg-default/60 p-3"
						:class="fullscreen ? 'max-h-[50vh]' : 'max-h-80'"
						@scroll="onLogScroll"
					>
						<pre
							v-if="displayLog"
							class="whitespace-pre-wrap wrap-break-word font-mono text-xs text-toned"
							>{{ displayLog }}</pre>
						<p
							v-else
							class="text-xs text-muted"
						>
							{{ logLoading ? 'Loading log...' : 'No log output yet.' }}
						</p>
					</div>
				</div>

				<!-- metadata -->
				<div
					class="grid gap-x-6 gap-y-2 rounded-lg border border-default p-4 text-sm sm:grid-cols-2"
				>
					<div
						v-for="row in metaRows"
						:key="row.label"
						class="flex items-start justify-between gap-3"
					>
						<span class="shrink-0 text-muted">{{ row.label }}</span>
						<span class="min-w-0 truncate text-right font-medium text-toned">{{ row.value }}</span>
					</div>
				</div>

				<!-- ephemeral sudo creds for restart (elevated runs); neither is persisted, so they must be
					re-supplied. the username prefills to the ssh user; a blank password uses the ssh password -->
				<div
					v-if="sudoEnabled"
					class="grid gap-4 rounded-lg border border-default p-3 bg-elevated/30 sm:grid-cols-2"
				>
					<UFormField
						label="Sudo Username"
						help="Defaults to the SSH user; only needed to restart"
					>
						<UInput
							v-model="sudoUser"
							autocomplete="off"
							:placeholder="selectedMachine?.username || 'root'"
							class="w-full font-mono"
						/>
					</UFormField>
					<UFormField
						label="Sudo Password"
						help="Blank uses the machine's SSH password. Sent only to restart; never stored."
					>
						<UInput
							v-model="sudoPassword"
							type="password"
							autocomplete="off"
							placeholder="sudo password"
							class="w-full font-mono"
						/>
					</UFormField>
				</div>

				<!-- the linked adapter was deleted: log stays, but artifacts are gone (downloads disabled) -->
				<UAlert
					v-if="adapterDeleted"
					color="warning"
					variant="subtle"
					icon="mdi:file-remove-outline"
					title="Adapter Deleted"
					description="The adapter created by this job was deleted, so its config and weights are no longer downloadable. The training log below is still available."
				/>

				<!-- actions -->
				<div class="flex flex-wrap items-center gap-2 border-t border-default pt-4">
					<UButton
						v-if="!terminal"
						color="error"
						variant="outline"
						icon="mdi:stop"
						:loading="aborting"
						@click="onAbort"
					>
						Abort
					</UButton>
					<UButton
						color="primary"
						variant="outline"
						icon="mdi:restart"
						:loading="restarting"
						:title="terminal ? 'Re-run this job' : 'Kill the current run and re-run it'"
						@click="onRestart"
					>
						{{ terminal ? 'Restart' : 'Kill and Restart' }}
					</UButton>
					<UButton
						color="neutral"
						variant="outline"
						icon="mdi:tune-variant"
						@click="onRelaunch"
					>
						Relaunch with Changes
					</UButton>

					<template v-if="downloadable">
						<UButton
							color="success"
							variant="ghost"
							icon="mdi:download"
							:to="`/api/training/jobs/${job.id}/artifact/weights`"
							external
							download
						>
							Download Weights
						</UButton>
						<UButton
							color="secondary"
							variant="ghost"
							icon="mdi:download"
							:to="`/api/training/jobs/${job.id}/artifact/config`"
							external
							download
						>
							Download Config
						</UButton>
					</template>

					<div class="grow" />
					<UButton
						v-if="terminal"
						color="error"
						variant="ghost"
						icon="mdi:trash-can-outline"
						:loading="deleting"
						@click="onDelete"
					>
						Delete
					</UButton>
				</div>
			</div>
		</template>
	</UModal>
</template>

<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';

const props = defineProps<{ open: boolean; jobId?: string | null }>();
const emit = defineEmits<{
	'update:open': [value: boolean];
	relaunch: [job: TrainingJobView];
	deleted: [id: string];
}>();

const store = useTrainingJobsStore();
const machinesStore = useMachinesStore();
const toast = useToast();

const fullscreen = ref(false);
const aborting = ref(false);
const restarting = ref(false);
const deleting = ref(false);
const sudoPassword = ref('');
const sudoUser = ref('');

// read the live copy from the store so polling keeps status/logTail fresh
const job = computed(() => store.jobs.find((j) => j.id === props.jobId) ?? store.current ?? null);

const ENGINE_LABELS: Record<TrainingEngine, string> = {
	doc2lora: 'doc2lora',
	peft: 'PEFT',
	accelerate: 'Accelerate'
};
const engineLabel = computed(() =>
	job.value ? (ENGINE_LABELS[job.value.engine] ?? job.value.engine) : ''
);
const headerTitle = computed(() => job.value?.machineLabel || 'Training Job');

const terminal = computed(() => (job.value ? isTerminalJob(job.value.status) : true));
const running = computed(() => !!job.value && !terminal.value);
const failed = computed(() => (job.value ? isFailedJob(job.value.status) : false));
// any completed job exposes its config + weights (download-only from the job, CF-deployable from the
// promoted adapter copy - the artifact endpoint resolves either)
const downloadable = computed(
	() => job.value?.status === 'completed' && (!!job.value.downloadOnly || !!job.value.adapterId)
);
// a completed CF-deployable job whose adapterId is now null means its adapter was deleted (the FK is
// onDelete:set-null): the artifacts are gone but the training log survives
const adapterDeleted = computed(
	() => job.value?.status === 'completed' && !job.value.downloadOnly && !job.value.adapterId
);

const selectedMachine = computed(() =>
	machinesStore.machines.find((m) => m.id === job.value?.machineId)
);
// an elevated run needs its sudo creds re-supplied to restart (they are never persisted)
const sudoEnabled = computed(() => !!job.value?.config.useSudo);
// prefill the sudo username with the ssh user for visibility (overridable)
watch([sudoEnabled, selectedMachine], () => {
	if (sudoEnabled.value && !sudoUser.value && selectedMachine.value)
		sudoUser.value = selectedMachine.value.username;
});

const failureTitleText = computed(() => (job.value ? failureTitle(job.value.failureClass) : ''));

const STATUS_HEADLINES: Record<JobStatus, string> = {
	queued: 'Queued',
	provisioning: 'Provisioning The Machine',
	launching: 'Launching',
	running: 'Training In Progress',
	syncing: 'Syncing The Adapter',
	verifying: 'Verifying The Output',
	publishing: 'Publishing',
	completed: 'Completed',
	failed: 'Failed',
	abnormal: 'Ended Abnormally',
	aborted: 'Aborted'
};
const statusHeadline = computed(() =>
	job.value ? (STATUS_HEADLINES[job.value.status] ?? job.value.status) : ''
);
const phaseLabel = computed(() => (job.value ? job.value.status : ''));

// ---- live log stream ----
// while running we mirror the probe's logTail (no extra ssh per tick - the probe already fetched it);
// a terminal job loads its full persisted log ONCE on open
const logText = ref('');
const logLoading = ref(false);
const follow = ref(true);
const logEl = ref<HTMLElement | null>(null);
let userScrolledUp = false;

function onLogScroll() {
	const el = logEl.value;
	if (!el) return;
	// scrolled up past the threshold -> stop fighting the user, turn follow off
	const scrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 48;
	userScrolledUp = scrolledUp;
	if (scrolledUp && follow.value) follow.value = false;
}

function scrollToBottom() {
	if (!follow.value || userScrolledUp) return;
	nextTick(() => {
		const el = logEl.value;
		if (el) el.scrollTop = el.scrollHeight;
	});
}

// toggling follow back on jumps to the live tail and resumes
watch(follow, (on) => {
	if (on) {
		userScrolledUp = false;
		scrollToBottom();
	}
});

async function loadFullLog() {
	if (!props.jobId) return;
	logLoading.value = !logText.value;
	try {
		const text = await store.fetchLog(props.jobId);
		if (text) logText.value = text;
		else if (!logText.value) logText.value = job.value?.logTail ?? '';
	} catch {
		if (!logText.value) logText.value = job.value?.logTail ?? '';
	} finally {
		logLoading.value = false;
	}
	scrollToBottom();
}

// running: follow the probe's tail with no extra ssh load
watch(
	() => job.value?.logTail,
	(t) => {
		if (running.value && t != null) {
			logText.value = t;
			scrollToBottom();
		}
	}
);

// collapse tqdm's carriage-return progress redraws to their final frame for display (the raw log keeps
// every frame for download); parsing still runs on the raw logText
const displayLog = computed(() => collapseCarriageReturns(logText.value));

const nowMs = ref(Date.now());
const progress = computed(() => parseTrainingProgress(logText.value));
const totalEpochs = computed(() => job.value?.config.epochs ?? null);
const percent = computed(() => progressPercent(progress.value, totalEpochs.value));
const showProgressBar = computed(() => running.value || percent.value != null);
const rate = computed(() => progress.value.rate);

// training has actually begun once the log shows a step/epoch/percent
const trainingStarted = computed(() => {
	const p = progress.value;
	return p.percent != null || p.step != null || p.epoch != null;
});
const preparing = computed(() => running.value && !trainingStarted.value);

// pre-training phase from the raw log: deps install vs base-model download vs the loop actually stepping.
// pass the raw log (the helper collapses cr internally); holds the training countdown until real training
const phase = computed(() => trainingPhase(logText.value));
// the run is in a pre-training phase (deps/model download) - no real training step has happened yet
const preTraining = computed(() => running.value && phase.value !== 'training');
const preTrainingLabel = computed(() =>
	phase.value === 'loading' ? 'Downloading Base Model' : 'Installing Dependencies'
);

const progressHeadline = computed(() => {
	if (preparing.value) return 'Preparing Environment';
	if (running.value) return 'Training In Progress';
	return statusHeadline.value;
});

const stepLabel = computed(() =>
	progress.value.step != null && progress.value.totalSteps
		? `Step ${progress.value.step} / ${progress.value.totalSteps}`
		: ''
);
const epochLabel = computed(() => {
	const e = progress.value.epoch;
	if (e == null) return '';
	// drop a trailing .00 so a whole epoch reads "3 / 3", not "3.00 / 3"
	const shown = Number(e.toFixed(2));
	const total = totalEpochs.value;
	return total ? `Epoch ${shown} / ${total}` : `Epoch ${shown}`;
});

// ---- live machine telemetry (probe-supplied) ----
// mb -> gb at 2 sig figs (e.g. 4397 -> "4.3 GB")
const gb = (mb: number) => Number((mb / 1024).toPrecision(2)) + ' GB';
// map a 0-100 usage percent to a nuxt ui semantic text-color class
function usageColor(pct: number | null): string {
	if (pct == null) return 'text-highlighted';
	if (pct < 10) return 'text-primary';
	if (pct < 75) return 'text-default';
	if (pct < 90) return 'text-warning';
	return 'text-error';
}
// build the visible stat list; each entry is dropped when its source value is null.
// `color` is set only for the 0-100 usage metrics (cpu/gpu/ram/vram); others stay neutral
const telemetryStats = computed(() => {
	const t = job.value?.telemetry;
	type Stat = { label: string; value: string; icon?: string; color?: string };
	if (!t) return [] as Stat[];
	const stats: Stat[] = [];
	if (t.cpuPct != null)
		stats.push({
			label: 'CPU',
			value: `${t.cpuPct}%`,
			icon: 'mdi:cpu-64-bit',
			color: usageColor(t.cpuPct)
		});
	if (t.ramUsedMb != null && t.ramTotalMb != null)
		stats.push({
			label: 'RAM',
			value: `${gb(t.ramUsedMb)} / ${gb(t.ramTotalMb)} Used`,
			icon: 'mdi:memory',
			color: usageColor((t.ramUsedMb / t.ramTotalMb) * 100)
		});
	if (t.gpuUtilPct != null)
		stats.push({
			label: 'GPU',
			value: `${t.gpuUtilPct}%`,
			icon: 'mdi:expansion-card',
			color: usageColor(t.gpuUtilPct)
		});
	if (t.vramUsedMb != null && t.vramTotalMb != null)
		stats.push({
			label: 'VRAM',
			value: `${gb(t.vramUsedMb)} / ${gb(t.vramTotalMb)} Used`,
			icon: 'mdi:memory',
			color: usageColor((t.vramUsedMb / t.vramTotalMb) * 100)
		});
	if (t.diskAvailGb != null)
		stats.push({ label: 'Disk Free', value: `${t.diskAvailGb} GB`, icon: 'mdi:harddisk' });
	if (t.outputBytes != null)
		stats.push({
			label: 'Output Size',
			value: formatBytes(t.outputBytes),
			icon: 'mdi:file-download-outline'
		});
	if (t.netRxMb != null && t.netTxMb != null) {
		// measure THIS run's usage (current - the first sample's baseline), not the box-wide cumulative
		// counter, so a running job's bandwidth is accurate from job start; adaptive B/KB/MB/GB
		const rx = formatBytes(Math.max(0, t.netRxMb - (t.netRxMb0 ?? t.netRxMb)) * 1024 * 1024);
		const tx = formatBytes(Math.max(0, t.netTxMb - (t.netTxMb0 ?? t.netTxMb)) * 1024 * 1024);
		stats.push({ label: 'Bandwidth', value: `RX ${rx} / TX ${tx}`, icon: 'mdi:swap-vertical' });
	}
	// surface epoch here too when known, kept consistent with epochLabel's source
	if (progress.value.epoch != null && totalEpochs.value)
		stats.push({
			label: 'Epoch',
			value: `${progress.value.epoch.toFixed(2)} / ${totalEpochs.value}`,
			icon: 'mdi:rotate-3d-variant'
		});
	return stats;
});

const startedMs = computed(() =>
	job.value?.startedAt ? new Date(job.value.startedAt).getTime() : null
);
const elapsedSecs = computed(() => {
	if (!startedMs.value) return 0;
	const end = job.value?.finishedAt ? new Date(job.value.finishedAt).getTime() : nowMs.value;
	return (end - startedMs.value) / 1000;
});
const elapsedLabel = computed(() =>
	elapsedSecs.value > 0 ? formatDuration(elapsedSecs.value) : ''
);

// the fallback (job.etaSeconds) already factors a cold dependency install, so it stays meaningful
// during the preparing phase too
const etaSecondsNum = computed(() =>
	trainingEtaSeconds({
		progress: progress.value,
		startedAtMs: startedMs.value,
		nowMs: nowMs.value,
		totalEpochs: totalEpochs.value,
		fallbackEtaSeconds: job.value?.etaSeconds ?? null
	})
);
const etaLabel = computed(() =>
	etaSecondsNum.value != null && etaSecondsNum.value > 0 ? formatDuration(etaSecondsNum.value) : ''
);
// past the estimate while still running -> overtime (the countdown has bottomed out at 0)
const overtime = computed(
	() => running.value && etaSecondsNum.value != null && etaSecondsNum.value <= 0
);

// once finished, say how the real duration compared to the estimate
const finishedNote = computed(() => {
	if (job.value?.status !== 'completed') return '';
	const est = job.value?.etaSeconds ?? null;
	if (!est || !startedMs.value || !job.value?.finishedAt) return '';
	const actual = (new Date(job.value.finishedAt).getTime() - startedMs.value) / 1000;
	const delta = actual - est;
	if (delta < -45) return `Finished ${formatDuration(-delta)} Under The Estimate`;
	if (delta > 45) return `Took ${formatDuration(delta)} Over The Estimate`;
	return 'Finished About On The Estimate';
});

// ---- completion summary ----
// show once the job is terminal; loss/timing data also surfaces for failed/abnormal runs since the
// log still holds whatever was logged before the run ended
const showSummary = computed(() => terminal.value && job.value?.status !== 'aborted');
const isCompleted = computed(() => job.value?.status === 'completed');

const outputNameLabel = computed(() => {
	const j = job.value;
	if (!j) return '';
	return j.config.outputName || `auto: ${j.machineLabel || 'machine'} adapter`;
});
const outputNameMuted = computed(() => !job.value?.config.outputName);
const outputSlugLabel = computed(() => job.value?.config.outputSlug || 'auto: trained-...');
const outputSlugMuted = computed(() => !job.value?.config.outputSlug);

// exact finish: keep the m/h shorthand but also show raw seconds + the absolute finish timestamp
const finishedAtLabel = computed(() =>
	job.value?.finishedAt ? formatDateTime(job.value.finishedAt) : ''
);
const exactElapsedSecs = computed(() => {
	const j = job.value;
	if (!j?.startedAt || !j.finishedAt) return null;
	return Math.round((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000);
});

// training-step series for the completion charts. doc2lora/Trainer buffer these dict logs and flush
// them at the END, so the charts are a completion view (no live population while running)
const series = computed(() => parseTrainingSeries(logText.value));
const hasSeries = computed(() => series.value.points.length >= 2);

// build {x,y} pairs from x/y accessors, dropping entries with a null/non-finite y (or x)
function chartPoints(
	xPick: (p: TrainingPoint) => number | null,
	yPick: (p: TrainingPoint) => number | null
): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = [];
	for (const p of series.value.points) {
		const y = yPick(p);
		if (y == null || !Number.isFinite(y)) continue;
		const x = xPick(p);
		if (x == null || !Number.isFinite(x)) continue;
		out.push({ x, y });
	}
	return out;
}
// loss/grad/lr plot against epoch (fall back to step); the epoch chart is per-step
const byEpoch = (p: TrainingPoint) => p.epoch ?? p.step;
const lossChartPoints = computed(() => chartPoints(byEpoch, (p) => p.loss));
const lrChartPoints = computed(() => chartPoints(byEpoch, (p) => p.lr));
const gradNormChartPoints = computed(() => chartPoints(byEpoch, (p) => p.gradNorm));
const epochChartPoints = computed(() =>
	chartPoints(
		(p) => p.step,
		(p) => p.epoch
	)
);
// grad norm is sometimes absent; only show its chart when we actually have a line
const hasGradNorm = computed(() => gradNormChartPoints.value.length >= 2);
// learning-rate ticks/tooltips read better in exponential form
const lrFormat = (v: number) => v.toExponential(2);

// per-chart explanations (sentence case)
const lossLegend =
	'Loss should trend down as the adapter fits the data. A steady decline is healthy; a flat or rising line means it is not learning (try more epochs or a higher learning rate), and wild spikes mean the learning rate is too high.';
const gradNormLegend =
	'Gradient norm is the size of each update. Small and stable is smooth training; large spikes or blow-ups mean instability (lower the learning rate or clip gradients).';
const lrLegend =
	'This is the learning-rate schedule (here it decays toward zero). It is set by your config, not learned - a flat line just means a constant schedule.';
const epochLegend =
	'How far training progressed through the dataset. It should rise steadily to your configured epoch count; stalling early means the run was cut short.';
const finalLossLabel = computed(() =>
	series.value.finalLoss != null ? series.value.finalLoss.toFixed(4) : '-'
);
const finalLrLabel = computed(() =>
	series.value.finalLr != null ? series.value.finalLr.toExponential(2) : '-'
);
const finalGradNormLabel = computed(() =>
	series.value.finalGradNorm != null ? series.value.finalGradNorm.toFixed(3) : '-'
);
const finalEpochLabel = computed(() =>
	// drop a trailing .00 so a whole epoch reads "3", not "3.00"
	series.value.finalEpoch != null ? String(Number(series.value.finalEpoch.toFixed(2))) : '-'
);

// final trainer summary stats (each dropped when its source is null)
const summaryStats = computed(() => {
	const s = series.value.summary;
	if (!s) return [] as { label: string; value: string }[];
	const out: { label: string; value: string }[] = [];
	if (s.trainRuntime != null)
		out.push({ label: 'Train Runtime', value: formatDuration(Math.round(s.trainRuntime)) });
	if (s.trainLoss != null) out.push({ label: 'Mean Loss', value: s.trainLoss.toFixed(4) });
	if (s.samplesPerSecond != null)
		out.push({ label: 'Samples / Sec', value: s.samplesPerSecond.toFixed(2) });
	if (s.stepsPerSecond != null)
		out.push({ label: 'Steps / Sec', value: s.stepsPerSecond.toFixed(2) });
	if (s.epoch != null) out.push({ label: 'Epochs', value: String(s.epoch) });
	return out;
});

// phase timing breakdown (install vs scan vs training)
const phaseTimings = computed(() => parsePhaseTimings(logText.value));
const maxPhaseSeconds = computed(() =>
	phaseTimings.value.reduce((max, p) => Math.max(max, p.seconds), 0)
);

// the run's own bandwidth = current cumulative counter - the baseline locked in at the first sample
const bandwidthUsed = computed(() => {
	const t = job.value?.telemetry;
	if (!t || t.netRxMb == null || t.netTxMb == null) return null;
	const rx = Math.max(0, t.netRxMb - (t.netRxMb0 ?? t.netRxMb));
	const tx = Math.max(0, t.netTxMb - (t.netTxMb0 ?? t.netTxMb));
	// telemetry counters are in megabytes; formatBytes wants bytes
	return { rx: formatBytes(rx * 1024 * 1024), tx: formatBytes(tx * 1024 * 1024) };
});

// ---- metadata rows ----
const metaRows = computed(() => {
	const j = job.value;
	if (!j) return [] as { label: string; value: string }[];
	const c = j.config;
	const rows: { label: string; value: string }[] = [
		{ label: 'Base Model', value: c.baseModel.split('/').pop() || c.baseModel },
		{ label: 'Machine', value: j.machineLabel || '-' },
		{ label: 'Device', value: c.device },
		{ label: 'Rank / Alpha', value: `${c.rank} / ${c.loraAlpha}` },
		{ label: 'Epochs', value: String(c.epochs) },
		{ label: 'Learning Rate', value: String(c.learningRate) },
		{ label: 'Batch / Grad Accum', value: `${c.batchSize} / ${c.gradientAccumulationSteps}` },
		{ label: 'Attempt', value: String(j.attempt) }
	];
	if (c.hfDataset) rows.push({ label: 'Dataset', value: c.hfDataset });
	else if (j.datasetId) rows.push({ label: 'Dataset', value: 'Uploaded Documents' });
	if (j.adapterSize) rows.push({ label: 'Adapter Size', value: formatBytes(j.adapterSize) });
	rows.push({ label: '4-bit (QLoRA)', value: c.load4bit ? 'On' : 'Off' });
	rows.push({
		label: 'Python venv',
		value: c.useVenv === false ? 'Off' : `On (${c.pythonVersion || '3.11'})`
	});
	rows.push({ label: 'Sudo', value: c.useSudo ? 'On' : 'Off' });
	if (j.createdAt) rows.push({ label: 'Created', value: formatDateTime(j.createdAt) });
	if (j.startedAt) rows.push({ label: 'Started', value: formatDateTime(j.startedAt) });
	if (j.finishedAt) rows.push({ label: 'Finished', value: formatDateTime(j.finishedAt) });
	return rows;
});

// ---- polling: advance the job while open + live (the probe updates logTail, which we mirror) ----
const { pause: pausePoll, resume: resumePoll } = useIntervalFn(
	async () => {
		if (!props.jobId) return;
		if (running.value) await store.poll(props.jobId).catch(() => {});
		// on the transition to terminal, swap the tail for the full persisted log once, then stop
		if (job.value && isTerminalJob(job.value.status)) {
			await loadFullLog();
			pausePoll();
		}
	},
	4000,
	{ immediate: false }
);
const { pause: pauseTick, resume: resumeTick } = useIntervalFn(
	() => {
		nowMs.value = Date.now();
	},
	1000,
	{ immediate: false }
);

watch(
	() => props.open,
	async (isOpen) => {
		if (isOpen) {
			logText.value = '';
			userScrolledUp = false;
			follow.value = true;
			sudoPassword.value = '';
			sudoUser.value = '';
			nowMs.value = Date.now();
			if (!machinesStore.machines.length) machinesStore.fetch().catch(() => {});
			// terminal: show the full persisted log; running: seed from the current probe tail
			if (terminal.value) await loadFullLog();
			else {
				logText.value = job.value?.logTail ?? '';
				scrollToBottom();
			}
			resumeTick();
			if (running.value) resumePoll();
		} else {
			pausePoll();
			pauseTick();
			fullscreen.value = false;
		}
	}
);

onBeforeUnmount(() => {
	pausePoll();
	pauseTick();
});

function onOpenChange(value: boolean) {
	emit('update:open', value);
	if (!value) fullscreen.value = false;
}
function close() {
	emit('update:open', false);
}

async function onAbort() {
	if (!props.jobId) return;
	aborting.value = true;
	try {
		await store.abort(props.jobId);
		toast.add({ title: 'Job Aborted', color: 'neutral', icon: 'mdi:cancel' });
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Abort Failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		aborting.value = false;
	}
}

// restart: kill a live run if needed, then re-queue the same job. an elevated key-auth run needs the
// sudo password re-supplied (it is never persisted)
async function onRestart() {
	if (!props.jobId || !job.value) return;
	restarting.value = true;
	try {
		await store.retry(props.jobId, {
			force: !terminal.value,
			sudoUser: sudoEnabled.value
				? sudoUser.value || selectedMachine.value?.username || undefined
				: undefined,
			sudoPassword: sudoEnabled.value && sudoPassword.value ? sudoPassword.value : undefined
		});
		sudoPassword.value = '';
		logText.value = '';
		resumeTick();
		resumePoll();
		toast.add({ title: 'Job Restarted', color: 'success', icon: 'mdi:restart' });
	} catch (e: any) {
		toast.add({
			title: e?.data?.statusMessage ?? e?.data?.message ?? 'Restart Failed',
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		restarting.value = false;
	}
}

function onRelaunch() {
	if (job.value) emit('relaunch', job.value);
}

async function onDelete() {
	if (!props.jobId) return;
	deleting.value = true;
	try {
		const id = props.jobId;
		await store.remove(id);
		toast.add({ title: 'Job Deleted', color: 'neutral', icon: 'mdi:trash-can' });
		emit('deleted', id);
		close();
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Delete Failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		deleting.value = false;
	}
}
</script>
