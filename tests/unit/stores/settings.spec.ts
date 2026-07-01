import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_ACCESS,
	DEFAULT_FEATURES,
	DEFAULT_LIMITS,
	DEFAULT_PERMISSIONS,
	DEFAULT_RATE_LIMITS
} from '~/shared/defaults';
import { useSettingsStore } from '~/stores/settings';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

describe('settings store', () => {
	it('fetch loads settings and marks loaded', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ name: 'MyLoRA', themeColor: 'blue' });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useSettingsStore();
		const res = await store.fetch();
		expect(res.name).toBe('MyLoRA');
		expect(store.loaded).toBe(true);
		expect(store.loading).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('fetch is idempotent unless forced', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ name: 'A' });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useSettingsStore();
		await store.fetch();
		await store.fetch();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await store.fetch(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('fetch returns current settings while another load is in flight', async () => {
		let resolveFn: (v: any) => void = () => {};
		const p = new Promise((r) => {
			resolveFn = r;
		});
		vi.stubGlobal('$fetch', vi.fn().mockReturnValue(p));
		const store = useSettingsStore();
		const first = store.fetch();
		const second = await store.fetch();
		expect(second).toEqual({});
		resolveFn({ name: 'done' });
		await first;
		expect(store.settings.name).toBe('done');
	});

	it('fetch error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'fe' } }));
		const store = useSettingsStore();
		await expect(store.fetch()).rejects.toBeTruthy();
		expect(store.error).toBe('fe');
		expect(store.loading).toBe(false);
	});

	it('save posts partial and updates settings', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ name: 'Saved' });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useSettingsStore();
		const res = await store.save({ name: 'Saved' });
		expect(res.name).toBe('Saved');
		expect(store.loaded).toBe(true);
		expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
	});

	it('save error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useSettingsStore();
		await expect(store.save({})).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to save settings');
		expect(store.loading).toBe(false);
	});

	it('typed getters fall back to defaults when unset', () => {
		const store = useSettingsStore();
		expect(store.permissions).toEqual(DEFAULT_PERMISSIONS);
		expect(store.access).toEqual(DEFAULT_ACCESS);
		expect(store.rateLimits).toEqual(DEFAULT_RATE_LIMITS);
		expect(store.limits).toEqual(DEFAULT_LIMITS);
		expect(store.features).toEqual(DEFAULT_FEATURES);
	});

	it('typed getters reflect loaded values', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({
				themeColor: 'red',
				name: 'N',
				description: 'D',
				author: 'A',
				bio: 'B',
				website: 'W',
				github: 'G',
				twitter: 'T',
				instagram: 'I',
				patreon: 'P',
				linkedin: 'L',
				discord: 'Dc',
				supportEmail: 'e@x.com',
				access: { ...DEFAULT_ACCESS, downloadAccess: 'private' }
			})
		);
		const store = useSettingsStore();
		await store.fetch();
		expect(store.themeColor).toBe('red');
		expect(store.name).toBe('N');
		expect(store.description).toBe('D');
		expect(store.author).toBe('A');
		expect(store.bio).toBe('B');
		expect(store.website).toBe('W');
		expect(store.github).toBe('G');
		expect(store.twitter).toBe('T');
		expect(store.instagram).toBe('I');
		expect(store.patreon).toBe('P');
		expect(store.linkedin).toBe('L');
		expect(store.discord).toBe('Dc');
		expect(store.supportEmail).toBe('e@x.com');
		expect(store.access.downloadAccess).toBe('private');
	});
});
