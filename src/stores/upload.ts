type AssetState = 'idle' | 'uploading' | 'done' | 'error';

export const useUploadStore = defineStore('upload', () => {
	const draftId = ref<string | null>(null);
	const draftSlug = ref<string | null>(null);
	const configState = ref<AssetState>('idle');
	const weightsState = ref<AssetState>('idle');
	const uploadProgress = ref(0);
	const status = ref<AdapterStatus | null>(null);
	const statusMessage = ref<string | null>(null);
	const job = ref<PushJob | null>(null);
	const polling = ref(false);
	const error = ref<string | null>(null);

	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	async function createDraft(payload: Record<string, unknown>) {
		error.value = null;
		try {
			const res = await $fetch<{ id: string; slug: string }>('/api/adapters/create', {
				method: 'POST',
				body: payload
			});
			draftId.value = res.id;
			draftSlug.value = res.slug;
			status.value = 'draft';
			return res.id;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to create draft';
			throw e;
		}
	}

	// shared multipart uploader; tracks progress via XHR where the env allows it
	async function uploadAsset(asset: 'config' | 'weights', file: File) {
		if (!draftId.value) throw new Error('No draft created');
		const stateRef = asset === 'config' ? configState : weightsState;
		stateRef.value = 'uploading';
		uploadProgress.value = 0;
		error.value = null;
		const form = new FormData();
		form.append('asset', asset);
		form.append('file', file);
		try {
			const res = await uploadWithProgress(`/api/adapters/${draftId.value}/upload`, form, (pct) => {
				uploadProgress.value = pct;
			});
			stateRef.value = 'done';
			uploadProgress.value = 100;
			if (res?.status) status.value = res.status as AdapterStatus;
			return res;
		} catch (e: any) {
			stateRef.value = 'error';
			error.value = e?.data?.message ?? e?.message ?? 'Upload failed';
			throw e;
		}
	}

	function uploadConfig(file: File) {
		return uploadAsset('config', file);
	}

	function uploadWeights(file: File) {
		return uploadAsset('weights', file);
	}

	async function uploadScreenshot(file: File) {
		if (!draftId.value) throw new Error('No draft created');
		error.value = null;
		const form = new FormData();
		form.append('file', file);
		try {
			return await $fetch<{ pathname: string; screenshots: string[] }>(
				`/api/adapters/${draftId.value}/screenshots`,
				{ method: 'POST', body: form }
			);
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Screenshot upload failed';
			throw e;
		}
	}

	async function startPublish() {
		if (!draftId.value) throw new Error('No draft created');
		error.value = null;
		// clear any stale job/message from a prior attempt so the ui never mixes states
		job.value = null;
		statusMessage.value = null;
		try {
			const res = await $fetch<{ ok: boolean; status: AdapterStatus }>(
				`/api/adapters/${draftId.value}/publish`,
				{ method: 'POST' }
			);
			status.value = res.status;

			// kick off polling for the push job
			pollStatus();
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Publish failed';
			throw e;
		}
	}

	// poll the push job until published or failed
	async function pollStatus() {
		if (!draftId.value) return;
		polling.value = true;
		try {
			const res = await $fetch<{
				status: AdapterStatus;
				statusMessage?: string;
				job?: PushJob;
			}>(`/api/adapters/${draftId.value}/status`);
			status.value = res.status;
			statusMessage.value = res.statusMessage ?? null;
			job.value = res.job ?? null;
			if (res.status === 'published' || res.status === 'failed') {
				stopPolling();
				return res;
			}
			pollTimer = setTimeout(() => pollStatus(), 1500);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to poll status';
			stopPolling();
			throw e;
		}
	}

	function stopPolling() {
		polling.value = false;
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function reset() {
		stopPolling();
		draftId.value = null;
		draftSlug.value = null;
		configState.value = 'idle';
		weightsState.value = 'idle';
		uploadProgress.value = 0;
		status.value = null;
		statusMessage.value = null;
		job.value = null;
		error.value = null;
	}

	return {
		draftId,
		draftSlug,
		configState,
		weightsState,
		uploadProgress,
		status,
		statusMessage,
		job,
		polling,
		error,
		createDraft,
		uploadConfig,
		uploadWeights,
		uploadScreenshot,
		startPublish,
		pollStatus,
		stopPolling,
		reset
	};
});

// xhr-based upload so we can report real progress; falls back to $fetch on the server
function uploadWithProgress(
	url: string,
	form: FormData,
	onProgress: (pct: number) => void
): Promise<any> {
	if (typeof XMLHttpRequest === 'undefined') {
		return $fetch(url, { method: 'POST', body: form });
	}
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', url);
		xhr.upload.onprogress = (ev) => {
			if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
				} catch {
					resolve({});
				}
			} else {
				let data: any;
				try {
					data = JSON.parse(xhr.responseText);
				} catch {
					data = undefined;
				}
				reject(
					Object.assign(new Error(data?.message ?? `Upload failed (${xhr.status})`), {
						data,
						statusCode: xhr.status
					})
				);
			}
		};
		xhr.onerror = () => reject(new Error('Network error during upload'));
		xhr.send(form);
	});
}
