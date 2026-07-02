type PushState = {
	status: AdapterStatus | null;
	job: PushJob | null;
	message: string | null;
	polling: boolean;
	error: string | null;
	startedAt: number | null;
};

// safety net: stop polling (and clear the spinner) even if the server never reports terminal, so the ui
// cannot hang forever. the cron reconciler finalizes the row server-side; a refresh then shows it
const MAX_POLL_MS = 8 * 60_000;

export const usePublishStore = defineStore('publish', () => {
	const states = reactive<Record<string, PushState>>({});
	const timers: Record<string, ReturnType<typeof setTimeout>> = {};

	function stateFor(id: string): PushState {
		if (!states[id])
			states[id] = {
				status: null,
				job: null,
				message: null,
				polling: false,
				error: null,
				startedAt: null
			};
		return states[id]!;
	}

	function isActive(id: string): boolean {
		const s = states[id];
		if (!s) return false;
		// a terminal status ends the spinner even if a stale job object lingers in state
		if (s.status === 'published' || s.status === 'failed') return false;
		return s.polling || !!s.job || s.status === 'pushing';
	}

	async function preflight(id: string, accountId?: string | null) {
		return $fetch<{
			canPublish: boolean | null;
			detail: string;
			accountLabel: string | null;
			accountId: string | null;
		}>(`/api/adapters/${id}/publish-preflight`, {
			query: accountId ? { accountId } : undefined
		});
	}

	async function start(id: string, accountId?: string | null) {
		const s = stateFor(id);
		s.error = null;
		s.job = null;
		s.message = null;
		s.startedAt = Date.now();
		try {
			const res = await $fetch<{ ok: boolean; status: AdapterStatus }>(
				`/api/adapters/${id}/publish`,
				{ method: 'POST', body: accountId ? { accountId } : {} }
			);
			s.status = res.status;
			poll(id);
			return res;
		} catch (e: any) {
			// a fast-fail (e.g. token lacks Workers AI: Edit -> 403 with guidance) lands here
			s.error = e?.data?.message ?? e?.data?.statusMessage ?? e?.message ?? 'Publish failed';
			s.status = 'failed';
			s.message = s.error;
			throw e;
		}
	}

	async function poll(id: string) {
		const s = stateFor(id);
		s.polling = true;
		if (!s.startedAt) s.startedAt = Date.now();
		// give up polling after the cap so the spinner can't hang; the server reconciler finalizes the row
		if (Date.now() - s.startedAt > MAX_POLL_MS) {
			s.message =
				s.message ?? 'Still publishing - this is taking longer than usual; refresh shortly.';
			stop(id);
			return;
		}
		try {
			const res = await $fetch<{ status: AdapterStatus; statusMessage?: string; job?: PushJob }>(
				`/api/adapters/${id}/status`
			);
			s.status = res.status;
			s.message = res.statusMessage ?? null;
			s.job = res.job ?? null;
			if (res.status === 'published' || res.status === 'failed') {
				stop(id);
				return res;
			}
			timers[id] = setTimeout(() => poll(id), 1500);
			return res;
		} catch (e: any) {
			s.error = e?.data?.message ?? e?.message ?? 'Failed to poll status';
			stop(id);
			throw e;
		}
	}

	function stop(id: string) {
		const s = states[id];
		if (s) s.polling = false;
		if (timers[id]) {
			clearTimeout(timers[id]);
			delete timers[id];
		}
	}

	// resolve once a given adapter's push settles (polling stops)
	function settled(id: string): Promise<void> {
		return new Promise((resolve) => {
			const s = stateFor(id);
			if (!s.polling) return resolve();
			const unwatch = watch(
				() => stateFor(id).polling,
				(polling) => {
					if (!polling) {
						unwatch();
						resolve();
					}
				}
			);
		});
	}

	function clear(id: string) {
		stop(id);
		delete states[id];
	}

	return { states, stateFor, isActive, preflight, start, poll, stop, settled, clear };
});
