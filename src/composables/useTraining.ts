import { useIntervalFn } from '@vueuse/core';

type JobEvent = {
	id: string;
	status: JobStatus;
	failureClass: FailureClass;
	statusMessage?: string | null;
	machineLabel?: string | null;
	finishedAt?: string | null;
	updatedAt: string;
};

const LAST_SEEN_KEY = 'mylora:training-last-seen';
const POLL_MS = 8000;

// per-job-id -> last status we already toasted (survives reloads)
function loadLastSeen(): Record<string, JobStatus> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(LAST_SEEN_KEY);
		return raw ? (JSON.parse(raw) as Record<string, JobStatus>) : {};
	} catch {
		return {};
	}
}

function saveLastSeen(map: Record<string, JobStatus>) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
	} catch {}
}

export function useTrainingNotifications() {
	const toast = useToast();
	const store = useTrainingJobsStore();

	const lastSeen = ref<Record<string, JobStatus>>(loadLastSeen());
	// jobs that went terminal but the user has not visited the page since
	const unseen = ref(0);
	// most recent updatedAt we processed, so the events feed only returns new rows
	const since = ref<string | null>(null);

	function notify(ev: JobEvent) {
		const failed = isFailedJob(ev.status); // failed or abnormal
		const label = ev.machineLabel ? ` on ${ev.machineLabel}` : '';
		if (ev.status === 'completed') {
			toast.add({
				title: `Training Completed${label}`,
				description: ev.statusMessage ?? undefined,
				color: 'success',
				icon: 'mdi:check'
			});
			unseen.value++;
		} else if (failed) {
			toast.add({
				title:
					ev.status === 'abnormal'
						? `Training Ended Abnormally${label}`
						: `Training Failed${label}`,
				description: ev.statusMessage ?? undefined,
				color: 'error',
				icon: 'mdi:alert'
			});
			unseen.value++;
		}
	}

	async function check() {
		try {
			// refresh the store so consumers (lists, badges) stay live
			await store.fetch().catch(() => {});

			const query: Record<string, string> = {};
			if (since.value) query.since = since.value;
			const res = await $fetch<{ events: JobEvent[] }>('/api/training/jobs/events', { query });
			const map = { ...lastSeen.value };
			let dirty = false;
			for (const ev of res.events) {
				// advance the cursor regardless of whether we toast
				if (!since.value || ev.updatedAt > since.value) since.value = ev.updatedAt;
				if (!isTerminalJob(ev.status)) continue;
				if (map[ev.id] === ev.status) continue; // already toasted this transition
				map[ev.id] = ev.status;
				dirty = true;
				notify(ev);
			}
			if (dirty) {
				lastSeen.value = map;
				saveLastSeen(map);
			}
		} catch {
			// defensive: a transient poll failure must not break the dashboard
		}
	}

	const { pause, resume, isActive } = useIntervalFn(check, POLL_MS, { immediate: false });

	function start() {
		if (isActive.value) return;
		// prime once so the cursor is set and any backlog clears immediately
		check();
		resume();
	}

	function stop() {
		pause();
	}

	function clearUnseen() {
		unseen.value = 0;
	}

	return { start, stop, check, unseen, clearUnseen };
}

export function useTrainingJobs() {
	const store = useTrainingJobsStore();
	const { jobs, loading, error, current, activeJobs } = storeToRefs(store);
	return {
		jobs,
		loading,
		error,
		current,
		activeJobs,
		fetchJobs: store.fetch,
		fetchJob: store.fetchOne,
		createJob: store.create,
		pollJob: store.poll,
		abortJob: store.abort,
		retryJob: store.retry,
		uploadDataset: store.uploadDataset
	};
}
