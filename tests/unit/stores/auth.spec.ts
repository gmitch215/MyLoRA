import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '~/stores/auth';
import { useSettingsStore } from '~/stores/settings';

// mutable session refs the mock reads from; tests set them per case
const { userRef, loggedInRef, fetchMock, clearMock } = vi.hoisted(() => ({
	userRef: { value: null as any },
	loggedInRef: { value: false },
	fetchMock: vi.fn(),
	clearMock: vi.fn()
}));

mockNuxtImport('useUserSession', () => () => ({
	user: userRef,
	loggedIn: loggedInRef,
	fetch: fetchMock,
	clear: clearMock
}));

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	userRef.value = null;
	loggedInRef.value = false;
});

describe('auth store', () => {
	it('exposes null user/role and false flags when logged out', () => {
		const store = useAuthStore();
		expect(store.user).toBeNull();
		expect(store.loggedIn).toBe(false);
		expect(store.role).toBeNull();
		expect(store.isAdmin).toBe(false);
		expect(store.isManager).toBe(false);
		expect(store.isDeveloper).toBe(false);
	});

	it('derives role flags for administrator', () => {
		userRef.value = { id: '1', username: 'a', role: 'administrator' };
		loggedInRef.value = true;
		const store = useAuthStore();
		expect(store.role).toBe('administrator');
		expect(store.isAdmin).toBe(true);
		expect(store.isManager).toBe(true);
		expect(store.isDeveloper).toBe(true);
	});

	it('manager is manager but not admin', () => {
		userRef.value = { id: '2', username: 'm', role: 'manager' };
		loggedInRef.value = true;
		const store = useAuthStore();
		expect(store.isAdmin).toBe(false);
		expect(store.isManager).toBe(true);
	});

	it('login posts credentials and refreshes the session', async () => {
		const $fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: true, user: { id: '1', role: 'developer' } });
		vi.stubGlobal('$fetch', $fetchMock);
		const store = useAuthStore();
		const res = await store.login('u', 'p');
		expect(res.ok).toBe(true);
		expect($fetchMock.mock.calls[0]![1].body).toEqual({ username: 'u', password: 'p' });
		expect(fetchMock).toHaveBeenCalled();
		expect(store.pending).toBe(false);
	});

	it('login error path sets error and clears pending', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'bad creds' } }));
		const store = useAuthStore();
		await expect(store.login('u', 'p')).rejects.toBeTruthy();
		expect(store.error).toBe('bad creds');
		expect(store.pending).toBe(false);
	});

	it('login uses fallback message', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useAuthStore();
		await expect(store.login('u', 'p')).rejects.toBeTruthy();
		expect(store.error).toBe('Login failed');
	});

	it('logout hits the endpoint then clears and refreshes', async () => {
		const $fetchMock = vi.fn().mockResolvedValue({});
		vi.stubGlobal('$fetch', $fetchMock);
		const store = useAuthStore();
		await store.logout();
		expect($fetchMock).toHaveBeenCalledWith('/api/logout', { method: 'POST' });
		expect(clearMock).toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalled();
	});

	it('logout ignores network errors and still clears', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('offline')));
		const store = useAuthStore();
		await store.logout();
		expect(clearMock).toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalled();
	});

	it('fetchSession delegates to session.fetch', async () => {
		const store = useAuthStore();
		await store.fetchSession();
		expect(fetchMock).toHaveBeenCalled();
	});

	it('can returns false when logged out', () => {
		const store = useAuthStore();
		expect(store.can('canCreate')).toBe(false);
	});

	it('can grants everything to administrators', () => {
		userRef.value = { id: '1', role: 'administrator' };
		loggedInRef.value = true;
		const store = useAuthStore();
		expect(store.can('canCreate')).toBe(true);
		expect(store.can('canDeleteAny')).toBe(true);
		expect(store.can('canManageAccounts')).toBe(true);
	});

	it('can resolves developer capabilities from settings matrix', () => {
		userRef.value = { id: '3', role: 'developer' };
		loggedInRef.value = true;
		// default permissions: developer canCreate true, canPublish false
		useSettingsStore();
		const store = useAuthStore();
		expect(store.can('canCreate')).toBe(true);
		expect(store.can('canPublish')).toBe(false);
	});
});
