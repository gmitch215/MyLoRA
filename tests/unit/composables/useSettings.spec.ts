import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '~/composables/useSettings';

const fetchMock = vi.fn();

beforeEach(() => {
	setActivePinia(createPinia());
	fetchMock.mockReset();
	vi.stubGlobal('$fetch', fetchMock);
});

describe('useSettings', () => {
	it('fetchSettings loads settings into the reactive ref', async () => {
		fetchMock.mockResolvedValue({ name: 'MyLoRA', description: 'hub' });
		const { settings, fetchSettings } = useSettings();
		const res = await fetchSettings();
		expect(res).toEqual({ name: 'MyLoRA', description: 'hub' });
		expect(settings.value.name).toBe('MyLoRA');
		expect(fetchMock).toHaveBeenCalledWith('/api/settings');
	});

	it('fetchSettings is idempotent unless forced', async () => {
		fetchMock.mockResolvedValue({ name: 'A' });
		const { fetchSettings } = useSettings();
		await fetchSettings();
		await fetchSettings();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await fetchSettings(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('saveSettings posts a partial and updates the ref', async () => {
		fetchMock.mockResolvedValue({ name: 'Renamed' });
		const { settings, saveSettings } = useSettings();
		const res = await saveSettings({ name: 'Renamed' });
		expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
			method: 'POST',
			body: { name: 'Renamed' }
		});
		expect(res.name).toBe('Renamed');
		expect(settings.value.name).toBe('Renamed');
	});

	it('saveSettings rethrows on failure', async () => {
		fetchMock.mockRejectedValue({ data: { message: 'nope' } });
		const { saveSettings } = useSettings();
		await expect(saveSettings({ name: 'x' })).rejects.toBeTruthy();
	});
});
