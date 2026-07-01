import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalyticsStore } from '~/stores/analytics';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

describe('analytics store', () => {
	it('fetchSummary loads summary with default range', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ downloads: 10 });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useAnalyticsStore();
		const res = await store.fetchSummary();
		expect(res).toEqual({ downloads: 10 });
		expect(store.summary).toEqual({ downloads: 10 });
		expect(store.loading).toBe(false);
		expect(fetchMock.mock.calls[0]![1].query.range).toBe('7d');
	});

	it('fetchSummary updates range when passed', async () => {
		const fetchMock = vi.fn().mockResolvedValue({});
		vi.stubGlobal('$fetch', fetchMock);
		const store = useAnalyticsStore();
		await store.fetchSummary('30d');
		expect(store.range).toBe('30d');
		expect(fetchMock.mock.calls[0]![1].query.range).toBe('30d');
	});

	it('fetchSummary surfaces error and clears loading', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'down' }));
		const store = useAnalyticsStore();
		await expect(store.fetchSummary()).rejects.toBeTruthy();
		expect(store.error).toBe('down');
		expect(store.loading).toBe(false);
	});

	it('fetchSummary uses fallback message', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useAnalyticsStore();
		await expect(store.fetchSummary()).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to load analytics');
	});

	it('setRange mutates range only', () => {
		const store = useAnalyticsStore();
		store.setRange('90d');
		expect(store.range).toBe('90d');
	});
});
