import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import Filters from '~/components/adapter/Filters.vue';

// control the adapters store so filter/sort side-effects are observable without a live backend
const setFilter = vi.fn();
const setSort = vi.fn();
const fetchList = vi.fn().mockResolvedValue({});
const store = reactive({
	loading: false,
	filters: { q: '', baseModel: '', modelType: '', tag: '' },
	sort: 'newest',
	setFilter,
	setSort,
	fetchList
});
mockNuxtImport('useAdaptersStore', () => () => store);

// real router/route from the test app; only the query is controlled per test
const routeQuery = ref<Record<string, string>>({});
mockNuxtImport('useRoute', () => () => ({ query: routeQuery.value }));

beforeEach(() => {
	vi.clearAllMocks();
	store.filters = { q: '', baseModel: '', modelType: '', tag: '' };
	store.sort = 'newest';
	routeQuery.value = {};
	vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([]));
});

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('AdapterFilters', () => {
	it('renders the filter controls', async () => {
		const w = await mountSuspended(Filters);
		expect(w.text()).toContain('Search');
		expect(w.text()).toContain('Base Model');
		expect(w.text()).toContain('Model Type');
		expect(w.text()).toContain('Sort');
	});

	it('applies filters on mount', async () => {
		await mountSuspended(Filters);
		await flush();
		expect(setFilter).toHaveBeenCalled();
		expect(fetchList).toHaveBeenCalled();
	});

	it('hydrates the search from the url query', async () => {
		routeQuery.value = { q: 'gemma', tag: 'chat' };
		const w = await mountSuspended(Filters);
		await flush();
		expect(w.text()).toContain('chat');
		expect(setFilter).toHaveBeenCalledWith(expect.objectContaining({ q: 'gemma', tag: 'chat' }));
	});

	it('shows a removable tag chip and clears it', async () => {
		routeQuery.value = { tag: 'nsfw' };
		const w = await mountSuspended(Filters);
		await flush();
		expect(w.text()).toContain('nsfw');
		const clearBtn = w.findComponent({ name: 'UButton' });
		await clearBtn.trigger('click');
		await flush();
		// the last setFilter call clears the tag
		const lastCall = setFilter.mock.calls.at(-1)![0];
		expect(lastCall.tag).toBe('');
	});

	it('queries the live models endpoint on mount', async () => {
		const fetchMock = vi.fn().mockResolvedValue([{ model: '@cf/meta/llama-3' }]);
		vi.stubGlobal('$fetch', fetchMock);
		await mountSuspended(Filters);
		await flush();
		expect(fetchMock).toHaveBeenCalledWith('/api/infer/models');
	});

	it('keeps the static fallback when the models endpoint fails', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('down')));
		const w = await mountSuspended(Filters);
		await flush();
		// still renders without throwing
		expect(w.text()).toContain('Base Model');
	});
});
