import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdaptersStore } from '~/stores/adapters';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function adapter(id: string, extra: Record<string, unknown> = {}) {
	return { id, slug: `s-${id}`, name: id, ...extra } as any;
}

describe('adapters store', () => {
	it('fetchList replaces items and stores paging meta', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ items: [adapter('a')], total: 5, page: 2, pageSize: 24 });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useAdaptersStore();
		const res = await store.fetchList();
		expect(store.items).toHaveLength(1);
		expect(store.total).toBe(5);
		expect(store.page).toBe(2);
		expect(store.loading).toBe(false);
		expect(res.total).toBe(5);
	});

	it('fetchList appends when opts.append is set', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ items: [adapter('a')], total: 1, page: 1, pageSize: 24 })
		);
		const store = useAdaptersStore();
		await store.fetchList();
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ items: [adapter('b')], total: 2, page: 2, pageSize: 24 })
		);
		await store.fetchList({ append: true });
		expect(store.items.map((a) => a.id)).toEqual(['a', 'b']);
	});

	it('buildQuery includes only non-empty filters', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 24 });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useAdaptersStore();
		store.setFilter({ q: 'foo', baseModel: 'llama', modelType: 'text' as any, tag: 't1' });
		store.setSort('downloads');
		await store.fetchList();
		const q = fetchMock.mock.calls[0]![1].query;
		expect(q).toMatchObject({
			q: 'foo',
			baseModel: 'llama',
			modelType: 'text',
			tag: 't1',
			sort: 'downloads',
			page: 1
		});
	});

	it('fetchList surfaces error message on failure', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'boom' } }));
		const store = useAdaptersStore();
		await expect(store.fetchList()).rejects.toBeTruthy();
		expect(store.error).toBe('boom');
		expect(store.loading).toBe(false);
	});

	it('fetchMine populates mineItems separately', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ items: [adapter('m')], total: 1, page: 1, pageSize: 200 })
		);
		const store = useAdaptersStore();
		await store.fetchMine();
		expect(store.mineItems).toHaveLength(1);
		expect(store.mineLoading).toBe(false);
	});

	it('fetchMine error path sets error and clears loading', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'nope' }));
		const store = useAdaptersStore();
		await expect(store.fetchMine()).rejects.toBeTruthy();
		expect(store.error).toBe('nope');
		expect(store.mineLoading).toBe(false);
	});

	it('fetchOne sets current', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(adapter('one')));
		const store = useAdaptersStore();
		const res = await store.fetchOne('s-one');
		expect(store.current?.id).toBe('one');
		expect(res?.id).toBe('one');
	});

	it('fetchOne error uses fallback message', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useAdaptersStore();
		await expect(store.fetchOne('x')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to load adapter');
	});

	it('create posts payload and returns id/slug', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ id: 'n', slug: 'sn' }));
		const store = useAdaptersStore();
		const res = await store.create({ name: 'X' });
		expect(res).toEqual({ id: 'n', slug: 'sn' });
	});

	it('update patches current, items, and mineItems in place', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ items: [adapter('a')], total: 1, page: 1, pageSize: 24 })
		);
		const store = useAdaptersStore();
		await store.fetchList();
		await store.fetchMine();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(adapter('a')));
		await store.fetchOne('s-a');
		const updated = adapter('a', { name: 'renamed' });
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(updated));
		const res = await store.update({ id: 'a', name: 'renamed' });
		expect(res.name).toBe('renamed');
		expect(store.current?.name).toBe('renamed');
		expect(store.items[0]!.name).toBe('renamed');
		expect(store.mineItems[0]!.name).toBe('renamed');
	});

	it('update leaves lists alone when id not present', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(adapter('z')));
		const store = useAdaptersStore();
		const res = await store.update({ id: 'z' });
		expect(res.id).toBe('z');
		expect(store.items).toHaveLength(0);
	});

	it('remove filters lists and clears current', async () => {
		vi.stubGlobal(
			'$fetch',
			vi
				.fn()
				.mockResolvedValue({ items: [adapter('a'), adapter('b')], total: 2, page: 1, pageSize: 24 })
		);
		const store = useAdaptersStore();
		await store.fetchList();
		await store.fetchMine();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(adapter('a')));
		await store.fetchOne('s-a');
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ ok: true, reclaimed: true }));
		const res = await store.remove('a');
		expect(res.ok).toBe(true);
		expect(store.items.map((a) => a.id)).toEqual(['b']);
		expect(store.mineItems.map((a) => a.id)).toEqual(['b']);
		expect(store.current).toBeNull();
	});

	it('setFilter resets page to 1', () => {
		const store = useAdaptersStore();
		store.setPage(5);
		store.setFilter({ q: 'hi' });
		expect(store.page).toBe(1);
		expect(store.filters.q).toBe('hi');
	});

	it('setSort resets page and setPage sets page', () => {
		const store = useAdaptersStore();
		store.setPage(3);
		expect(store.page).toBe(3);
		store.setSort('name');
		expect(store.sort).toBe('name');
		expect(store.page).toBe(1);
	});

	it('reset clears everything', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ items: [adapter('a')], total: 1, page: 1, pageSize: 24 })
		);
		const store = useAdaptersStore();
		await store.fetchList();
		store.setFilter({ q: 'x', baseModel: 'b', modelType: 'text' as any, tag: 't' });
		store.setSort('downloads');
		store.reset();
		expect(store.items).toHaveLength(0);
		expect(store.total).toBe(0);
		expect(store.current).toBeNull();
		expect(store.filters.q).toBe('');
		expect(store.sort).toBe('newest');
		expect(store.page).toBe(1);
		expect(store.error).toBeNull();
	});
});
