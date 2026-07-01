<template>
	<UDashboardPanel id="training">
		<template #header>
			<UDashboardNavbar
				title="Training"
				icon="i-lucide-cpu"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<div class="flex items-center gap-2">
						<TrainingNotifications />
						<UButton
							icon="mdi:plus"
							color="info"
							:disabled="!hasMachines"
							:title="hasMachines ? undefined : 'Add a machine first'"
							@click="openNew"
						>
							New Training Job
						</UButton>
					</div>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UAlert
				v-if="!hasMachines"
				icon="mdi:server-off"
				color="warning"
				variant="subtle"
				title="No Machines Registered"
				class="mb-4"
			>
				<template #description>
					Add a training machine before launching a job.
					<ULink
						to="/dashboard/machines"
						class="font-medium underline"
						>Go to Training Machines</ULink
					>.
				</template>
			</UAlert>

			<div
				v-if="!jobsStore.jobs.length && !jobsStore.loading"
				class="rounded-lg border border-dashed border-default p-10 text-center"
			>
				<UIcon
					name="i-lucide-cpu"
					class="mx-auto size-10 text-dimmed"
				/>
				<p class="mt-3 text-sm font-medium text-highlighted">No Training Jobs Yet</p>
				<p class="mt-1 text-xs text-muted">
					Launch a job to fine-tune a LoRA adapter on one of your machines.
				</p>
			</div>

			<div
				v-else
				class="space-y-4"
			>
				<TrainingJobCard
					v-for="job in sortedJobs"
					:key="job.id"
					:job="job"
					@relaunch="onRelaunch"
					@open="openDetail"
					@delete="askDelete"
				/>
			</div>

			<TrainingJobLaunchModal
				v-model:open="launchOpen"
				:prefill="prefillJob"
				@submit="onLaunched"
			/>

			<TrainingJobDetailModal
				v-model:open="detailOpen"
				:job-id="detailJobId"
				@relaunch="onRelaunchFromDetail"
				@deleted="onLaunched"
			/>

			<!-- delete confirmation (jobs are training history; the adapter row, if any, is kept) -->
			<UModal
				v-model:open="confirmOpen"
				title="Delete Training Job"
			>
				<template #body>
					<p class="text-sm text-muted">
						Delete this {{ pendingDelete?.status }} job from the history? Its logs and any
						download-only artifacts are removed. A published adapter is not affected.
					</p>
				</template>
				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton
							color="neutral"
							variant="outline"
							@click="confirmOpen = false"
						>
							Cancel
						</UButton>
						<UButton
							color="error"
							icon="mdi:trash-can-outline"
							:loading="deleting"
							@click="confirmDelete"
						>
							Delete
						</UButton>
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';

const jobsStore = useTrainingJobsStore();
const machinesStore = useMachinesStore();

definePageMeta({ layout: 'dashboard', middleware: 'training' });
useSeoMeta({ title: 'Training' });

const launchOpen = ref(false);
// a job to prefill the modal with (relaunch); null = a fresh New Job
const prefillJob = ref<TrainingJobView | null>(null);

// the big detail modal (live log stream + eta + actions)
const detailOpen = ref(false);
const detailJobId = ref<string | null>(null);

// delete confirmation
const confirmOpen = ref(false);
const deleting = ref(false);
const pendingDelete = ref<TrainingJobView | null>(null);
const toast = useToast();

await useAsyncData('training-jobs', async () => {
	await Promise.all([
		jobsStore.fetch(),
		machinesStore.machines.length ? Promise.resolve() : machinesStore.fetch().catch(() => {})
	]);
	return jobsStore.jobs.length;
});

const hasMachines = computed(() => machinesStore.machines.length > 0);

// active jobs first, then most recently updated
const sortedJobs = computed(() =>
	[...jobsStore.jobs].sort((a, b) => {
		const aActive = isTerminalJob(a.status) ? 1 : 0;
		const bActive = isTerminalJob(b.status) ? 1 : 0;
		if (aActive !== bActive) return aActive - bActive;
		return b.updatedAt.localeCompare(a.updatedAt);
	})
);

// poll active jobs every 5s while mounted - this is what advances jobs in dev/test
// where the cron/DO scheduler does not run
const { pause, resume } = useIntervalFn(
	async () => {
		const active = jobsStore.activeJobs;
		if (!active.length) return;
		await Promise.all(active.map((j) => jobsStore.poll(j.id).catch(() => {})));
	},
	5000,
	{ immediate: false }
);

onMounted(() => resume());
onBeforeUnmount(() => pause());

function openNew() {
	prefillJob.value = null;
	launchOpen.value = true;
}

// relaunch a prior job: prefill the modal so the user can tweak + launch a new job
function onRelaunch(job: TrainingJobView) {
	prefillJob.value = job;
	launchOpen.value = true;
}

function openDetail(job: TrainingJobView) {
	detailJobId.value = job.id;
	detailOpen.value = true;
}

// relaunch from inside the detail modal: close it, open the launch modal prefilled
function onRelaunchFromDetail(job: TrainingJobView) {
	detailOpen.value = false;
	onRelaunch(job);
}

function askDelete(job: TrainingJobView) {
	pendingDelete.value = job;
	confirmOpen.value = true;
}

async function confirmDelete() {
	if (!pendingDelete.value) return;
	deleting.value = true;
	try {
		await jobsStore.remove(pendingDelete.value.id);
		toast.add({ title: 'Job Deleted', color: 'neutral', icon: 'mdi:trash-can' });
		confirmOpen.value = false;
		pendingDelete.value = null;
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Delete Failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		deleting.value = false;
	}
}

function onLaunched() {
	// refresh so the new job appears immediately, then polling advances it
	jobsStore.fetch().catch(() => {});
}
</script>
