export const useTrainingJobsStore = defineStore('trainingJobs', () => {
	const jobs = ref<TrainingJobView[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const current = ref<TrainingJobView | null>(null);

	// patch local copies in place (array + current)
	function patch(job: TrainingJobView) {
		const idx = jobs.value.findIndex((j) => j.id === job.id);
		if (idx !== -1) jobs.value[idx] = job;
		if (current.value?.id === job.id) current.value = job;
	}

	async function fetch() {
		loading.value = true;
		error.value = null;
		try {
			const res = await $fetch<{ jobs: TrainingJobView[] }>('/api/training/jobs/list');
			jobs.value = res.jobs;
			return jobs.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load training jobs';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function fetchOne(id: string) {
		loading.value = true;
		error.value = null;
		try {
			const res = await $fetch<{ job: TrainingJobView }>(`/api/training/jobs/${id}`);
			current.value = res.job;
			patch(res.job);
			return current.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load training job';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: TrainingJobCreateInput) {
		error.value = null;
		try {
			const res = await $fetch<{ id: string }>('/api/training/jobs', {
				method: 'POST',
				body: payload
			});
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to create training job';
			throw e;
		}
	}

	async function poll(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ job: TrainingJobView }>(`/api/training/jobs/${id}/poll`, {
				method: 'POST'
			});
			patch(res.job);
			return res.job;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to poll training job';
			throw e;
		}
	}

	async function abort(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ job: TrainingJobView }>(`/api/training/jobs/${id}/abort`, {
				method: 'POST'
			});
			patch(res.job);
			return res.job;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to abort training job';
			throw e;
		}
	}

	async function retry(
		id: string,
		opts?: { force?: boolean; sudoUser?: string; sudoPassword?: string }
	) {
		error.value = null;
		try {
			const res = await $fetch<{ job: TrainingJobView }>(`/api/training/jobs/${id}/retry`, {
				method: 'POST',
				body: {
					force: opts?.force ?? false,
					sudoUser: opts?.sudoUser || undefined,
					sudoPassword: opts?.sudoPassword || undefined
				}
			});
			patch(res.job);
			return res.job;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to retry training job';
			throw e;
		}
	}

	// delete a job from the history (aborts it first if still running)
	async function remove(id: string) {
		error.value = null;
		try {
			await $fetch(`/api/training/jobs/${id}`, { method: 'DELETE' });
			jobs.value = jobs.value.filter((j) => j.id !== id);
			if (current.value?.id === id) current.value = null;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to delete training job';
			throw e;
		}
	}

	// the full train.log (live from the box for running jobs, the persisted copy once terminal)
	async function fetchLog(id: string) {
		const res = await $fetch<{ log: string; status: JobStatus }>(`/api/training/jobs/${id}/log`);
		return res.log;
	}

	async function uploadDataset(input: File | File[] | string) {
		error.value = null;
		try {
			let body: FormData | { text: string };
			if (typeof input === 'string') {
				body = { text: input };
			} else {
				const form = new FormData();
				for (const f of Array.isArray(input) ? input : [input]) form.append('file', f);
				body = form;
			}
			const res = await $fetch<{
				datasetId: string;
				size: number;
				inputKind: 'documents' | 'dataset';
				fileCount: number;
			}>('/api/training/datasets', { method: 'POST', body });
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to upload dataset';
			throw e;
		}
	}

	// ----- incremental doc2lora dataset (multi-file picker + url loading + per-item delete) -----

	type DatasetSummary = {
		datasetId: string;
		files: { name: string; size: number }[];
		size: number;
		fileCount: number;
		inputKind: 'documents' | 'dataset';
		added?: string;
	};

	// create an empty dataset the picker then adds files/urls to
	async function createDataset() {
		return $fetch<DatasetSummary>('/api/training/datasets', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: {}
		});
	}

	async function datasetInfo(id: string) {
		return $fetch<DatasetSummary>(`/api/training/datasets/${id}`);
	}

	// append one or many files (additive across clicks)
	async function addDatasetFiles(id: string, files: File[]) {
		const form = new FormData();
		for (const f of files) form.append('file', f);
		return $fetch<DatasetSummary>(`/api/training/datasets/${id}/files`, {
			method: 'POST',
			body: form
		});
	}

	// load a remote file by url (server validates content-type + fetches; no CORS). the doc2lora
	// install scope gates which content types are accepted
	async function addDatasetUrl(id: string, url: string, extras?: 'core' | 'docs' | 'all') {
		return $fetch<DatasetSummary>(`/api/training/datasets/${id}/url`, {
			method: 'POST',
			body: { url, extras }
		});
	}

	async function removeDatasetFile(id: string, name: string) {
		return $fetch<DatasetSummary>(`/api/training/datasets/${id}/files`, {
			method: 'DELETE',
			query: { name }
		});
	}

	// PEFT: search the public huggingface dataset catalog (proxied server-side, keyless)
	async function hfSearch(q: string) {
		try {
			const res = await $fetch<{
				results: { id: string; gated: boolean; downloads: number; likes: number }[];
			}>('/api/training/hf/search', { query: { q } });
			return res.results;
		} catch {
			return [];
		}
	}

	// PEFT: validate a huggingface dataset id (exists / gated / missing)
	async function hfValidateDataset(id: string) {
		return $fetch<{ id: string; valid: boolean; gated: boolean; status: number }>(
			'/api/training/hf/dataset',
			{ query: { id } }
		);
	}

	// validate a huggingface model id (exists / gated / missing) for the non-blocking access warning
	async function hfValidateModel(id: string) {
		return $fetch<{ id: string; valid: boolean; gated: boolean; status: number }>(
			'/api/training/hf/model',
			{ query: { id } }
		);
	}

	const activeJobs = computed(() => jobs.value.filter((j) => !isTerminalJob(j.status)));

	return {
		jobs,
		loading,
		error,
		current,
		fetch,
		fetchOne,
		create,
		poll,
		abort,
		hfSearch,
		hfValidateDataset,
		hfValidateModel,
		createDataset,
		datasetInfo,
		addDatasetFiles,
		addDatasetUrl,
		removeDatasetFile,
		retry,
		remove,
		fetchLog,
		uploadDataset,
		activeJobs
	};
});
