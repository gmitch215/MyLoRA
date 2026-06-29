export type AdapterSort = 'newest' | 'downloads' | 'inference' | 'name';

export type AdapterFilters = {
	q: string;
	baseModel: string;
	modelType: ModelType | '';
	tag: string;
};

type ListResponse = { items: Adapter[]; total: number; page: number; pageSize: number };

export const useAdaptersStore = defineStore('adapters', () => {
	const items = ref<Adapter[]>([]);
	const total = ref(0);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const current = ref<Adapter | null>(null);

	const filters = reactive<AdapterFilters>({ q: '', baseModel: '', modelType: '', tag: '' });
	const sort = ref<AdapterSort>('newest');
	const page = ref(1);
	const pageSize = ref(24);

	// build the list query from the current filters/sort/paging
	function buildQuery() {
		const query: Record<string, string | number> = {
			sort: sort.value,
			page: page.value,
			pageSize: pageSize.value
		};
		if (filters.q) query.q = filters.q;
		if (filters.baseModel) query.baseModel = filters.baseModel;
		if (filters.modelType) query.modelType = filters.modelType;
		if (filters.tag) query.tag = filters.tag;
		return query;
	}

	async function fetchList(opts?: { append?: boolean }) {
		loading.value = true;
		error.value = null;
		try {
			const res = await $fetch<ListResponse>('/api/adapters/list', { query: buildQuery() });
			items.value = opts?.append ? [...items.value, ...res.items] : res.items;
			total.value = res.total;
			page.value = res.page;
			pageSize.value = res.pageSize;
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load adapters';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function fetchOne(slug: string) {
		loading.value = true;
		error.value = null;
		try {
			current.value = await $fetch<Adapter>('/api/adapters/find', { query: { slug } });
			return current.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load adapter';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: Record<string, unknown>) {
		const res = await $fetch<{ id: string; slug: string }>('/api/adapters/create', {
			method: 'POST',
			body: payload
		});
		return res;
	}

	async function update(payload: Record<string, unknown> & { id: string }) {
		const updated = await $fetch<Adapter>('/api/adapters/update', {
			method: 'PATCH',
			body: payload
		});
		// patch local copies in place
		if (current.value?.id === updated.id) current.value = updated;
		const idx = items.value.findIndex((a) => a.id === updated.id);
		if (idx !== -1) items.value[idx] = updated;
		return updated;
	}

	async function remove(id: string) {
		const res = await $fetch<{ ok: boolean; reclaimed: boolean }>('/api/adapters/remove', {
			method: 'DELETE',
			query: { id }
		});
		items.value = items.value.filter((a) => a.id !== id);
		if (current.value?.id === id) current.value = null;
		return res;
	}

	function setFilter(partial: Partial<AdapterFilters>) {
		Object.assign(filters, partial);
		page.value = 1;
	}

	function setSort(s: AdapterSort) {
		sort.value = s;
		page.value = 1;
	}

	function setPage(n: number) {
		page.value = n;
	}

	function reset() {
		items.value = [];
		total.value = 0;
		current.value = null;
		filters.q = '';
		filters.baseModel = '';
		filters.modelType = '';
		filters.tag = '';
		sort.value = 'newest';
		page.value = 1;
		error.value = null;
	}

	return {
		items,
		total,
		loading,
		error,
		current,
		filters,
		sort,
		page,
		pageSize,
		fetchList,
		fetchOne,
		create,
		update,
		remove,
		setFilter,
		setSort,
		setPage,
		reset
	};
});
