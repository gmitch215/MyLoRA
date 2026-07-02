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
	// the current user's own adapters, kept SEPARATE from the public grid `items` so the dashboard is
	// never a filtered/paginated slice of the shared feed (that made owned rows vanish)
	const mineItems = ref<Adapter[]>([]);
	const mineLoading = ref(false);
	const total = ref(0);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const current = ref<Adapter | null>(null);

	const filters = reactive<AdapterFilters>({ q: '', baseModel: '', modelType: '', tag: '' });
	const sort = ref<AdapterSort>('newest');
	const page = ref(1);
	const pageSize = ref(24);

	const LIST_TTL = 20_000;
	const ONE_TTL = 20_000;
	const listCache = new Map<string, { res: ListResponse; ts: number }>();
	const listInflight = new Map<string, Promise<ListResponse>>();
	const oneCache = new Map<string, { adapter: Adapter; ts: number }>();
	const oneInflight = new Map<string, Promise<Adapter>>();

	function invalidateListCache() {
		listCache.clear();
		listInflight.clear();
		oneCache.clear();
	}

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

	// list rows carry the full adapter, so seed the detail cache from them: clicking a grid/dashboard
	// row then opens /adapters/[slug] instantly (cache hit) instead of blocking on find.get
	function seedOne(list: Adapter[]) {
		const ts = Date.now();
		for (const a of list) if (a.slug) oneCache.set(a.slug, { adapter: a, ts });
	}

	function applyList(res: ListResponse, append?: boolean) {
		items.value = append ? [...items.value, ...res.items] : res.items;
		total.value = res.total;
		page.value = res.page;
		pageSize.value = res.pageSize;
		seedOne(res.items);
	}

	// fetch+cache+dedup shared by the public grid and the dashboard `mine` list
	function loadList(
		cacheKey: string,
		query: Record<string, string | number>,
		force: boolean
	): Promise<ListResponse> {
		const inflight = listInflight.get(cacheKey);
		if (inflight) return inflight;
		if (!force) {
			const hit = listCache.get(cacheKey);
			if (hit && Date.now() - hit.ts < LIST_TTL) return Promise.resolve(hit.res);
		}
		const p = $fetch<ListResponse>('/api/adapters/list', { query })
			.then((res) => {
				listCache.set(cacheKey, { res, ts: Date.now() });
				return res;
			})
			.finally(() => listInflight.delete(cacheKey));
		listInflight.set(cacheKey, p);
		return p;
	}

	async function fetchList(opts?: { append?: boolean; force?: boolean }) {
		const query = buildQuery();
		// append (load-more) always fetches its own page and never dedups against the base list
		if (opts?.append) {
			loading.value = true;
			error.value = null;
			try {
				const res = await $fetch<ListResponse>('/api/adapters/list', { query });
				applyList(res, true);
				return res;
			} catch (e: any) {
				error.value = e?.data?.message ?? e?.message ?? 'Failed to load adapters';
				throw e;
			} finally {
				loading.value = false;
			}
		}
		const key = JSON.stringify(query);
		const cached = !opts?.force ? listCache.get(key) : undefined;
		if (cached && Date.now() - cached.ts < LIST_TTL) {
			applyList(cached.res);
			return cached.res;
		}
		loading.value = true;
		error.value = null;
		try {
			const res = await loadList(key, query, !!opts?.force);
			applyList(res);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load adapters';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function fetchMine(opts?: { force?: boolean }) {
		const query = { mine: 1, sort: 'newest', pageSize: 200 } as const;
		const key = 'mine';
		const cached = !opts?.force ? listCache.get(key) : undefined;
		if (cached && Date.now() - cached.ts < LIST_TTL) {
			mineItems.value = cached.res.items;
			seedOne(cached.res.items);
			return cached.res;
		}
		mineLoading.value = true;
		error.value = null;
		try {
			const res = await loadList(key, query, !!opts?.force);
			mineItems.value = res.items;
			seedOne(res.items);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load your adapters';
			throw e;
		} finally {
			mineLoading.value = false;
		}
	}

	async function fetchOne(slug: string, opts?: { force?: boolean }) {
		const cached = !opts?.force ? oneCache.get(slug) : undefined;
		if (cached && Date.now() - cached.ts < ONE_TTL) {
			current.value = cached.adapter;
			return cached.adapter;
		}
		const inflight = oneInflight.get(slug);
		if (inflight) {
			current.value = await inflight;
			return current.value;
		}
		loading.value = true;
		error.value = null;
		const p = $fetch<Adapter>('/api/adapters/find', { query: { slug } })
			.then((a) => {
				oneCache.set(slug, { adapter: a, ts: Date.now() });
				return a;
			})
			.finally(() => oneInflight.delete(slug));
		oneInflight.set(slug, p);
		try {
			current.value = await p;
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
		invalidateListCache();
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
		const midx = mineItems.value.findIndex((a) => a.id === updated.id);
		if (midx !== -1) mineItems.value[midx] = updated;
		invalidateListCache();
		return updated;
	}

	async function remove(id: string) {
		const res = await $fetch<{ ok: boolean; reclaimed: boolean }>('/api/adapters/remove', {
			method: 'DELETE',
			query: { id }
		});
		items.value = items.value.filter((a) => a.id !== id);
		mineItems.value = mineItems.value.filter((a) => a.id !== id);
		if (current.value?.id === id) current.value = null;
		invalidateListCache();
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
		mineItems,
		mineLoading,
		total,
		loading,
		error,
		current,
		filters,
		sort,
		page,
		pageSize,
		fetchList,
		fetchMine,
		fetchOne,
		create,
		update,
		remove,
		invalidateListCache,
		setFilter,
		setSort,
		setPage,
		reset
	};
});
