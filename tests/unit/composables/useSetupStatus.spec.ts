import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetupStatus } from '~/composables/useSetupStatus';

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('$fetch', fetchMock);
	// the composable shares a useState key across calls; reset it between tests
	clearNuxtState('mylora:setup-status');
});

describe('useSetupStatus', () => {
	it('refresh stores the fetched status', async () => {
		const status = { needsSetup: true, hasLegacyPassword: false, userCount: 0 };
		fetchMock.mockResolvedValue(status);
		const { status: s, refresh } = useSetupStatus();
		const res = await refresh();
		expect(res).toEqual(status);
		expect(s.value).toEqual(status);
		expect(fetchMock).toHaveBeenCalledWith('/api/setup/status', { credentials: 'include' });
	});

	it('refresh keeps the last-known status on error', async () => {
		const good = { needsSetup: false, hasLegacyPassword: false, userCount: 2 };
		fetchMock.mockResolvedValueOnce(good);
		const { status, refresh } = useSetupStatus();
		await refresh();
		fetchMock.mockRejectedValueOnce(new Error('down'));
		const res = await refresh();
		expect(res).toEqual(good);
		expect(status.value).toEqual(good);
	});

	it('ensure returns the cached status without fetching again', async () => {
		const cached = { needsSetup: false, hasLegacyPassword: true, userCount: 1 };
		fetchMock.mockResolvedValue(cached);
		const { ensure } = useSetupStatus();
		await ensure(); // primes it (shared useState key)
		fetchMock.mockClear();
		const res = await ensure();
		expect(res).toEqual(cached);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
