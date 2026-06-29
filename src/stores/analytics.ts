export const useAnalyticsStore = defineStore('analytics', () => {
	const summary = ref<any>(null);
	const range = ref('7d');
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function fetchSummary(r?: string) {
		if (r) range.value = r;
		loading.value = true;
		error.value = null;
		try {
			summary.value = await $fetch('/api/analytics/summary', { query: { range: range.value } });
			return summary.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load analytics';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	function setRange(r: string) {
		range.value = r;
	}

	return { summary, range, loading, error, fetchSummary, setRange };
});
