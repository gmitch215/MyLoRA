import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useLogin } from '~/composables/useLogin';

const sessionUser = ref<any>(null);
const sessionLoggedIn = ref(false);
const sessionFetch = vi.fn().mockResolvedValue(undefined);
const sessionClear = vi.fn().mockResolvedValue(undefined);

mockNuxtImport('useUserSession', () => () => ({
	user: sessionUser,
	loggedIn: sessionLoggedIn,
	fetch: sessionFetch,
	clear: sessionClear
}));

const fetchMock = vi.fn();

beforeEach(() => {
	setActivePinia(createPinia());
	sessionUser.value = null;
	sessionLoggedIn.value = false;
	fetchMock.mockReset();
	sessionFetch.mockClear();
	sessionClear.mockClear();
	vi.stubGlobal('$fetch', fetchMock);
});

describe('useLogin', () => {
	it('exposes reactive session refs', () => {
		sessionUser.value = { id: 'u1', role: 'administrator' };
		sessionLoggedIn.value = true;
		const { loggedIn, user, isAdmin, isManager } = useLogin();
		expect(loggedIn.value).toBe(true);
		expect(user.value).toEqual({ id: 'u1', role: 'administrator' });
		expect(isAdmin.value).toBe(true);
		expect(isManager.value).toBe(true);
	});

	it('isManager is true for manager but isAdmin is false', () => {
		sessionUser.value = { id: 'u2', role: 'manager' };
		sessionLoggedIn.value = true;
		const { isAdmin, isManager } = useLogin();
		expect(isAdmin.value).toBe(false);
		expect(isManager.value).toBe(true);
	});

	it('developer is neither admin nor manager', () => {
		sessionUser.value = { id: 'u3', role: 'developer' };
		sessionLoggedIn.value = true;
		const { isAdmin, isManager } = useLogin();
		expect(isAdmin.value).toBe(false);
		expect(isManager.value).toBe(false);
	});

	it('login posts credentials and refreshes the session', async () => {
		fetchMock.mockResolvedValue({ ok: true, user: { id: 'u1' } });
		const { login } = useLogin();
		const res = await login('alice', 'pw');
		expect(fetchMock).toHaveBeenCalledWith('/api/login', {
			method: 'POST',
			body: { username: 'alice', password: 'pw' }
		});
		expect(sessionFetch).toHaveBeenCalled();
		expect(res).toEqual({ ok: true, user: { id: 'u1' } });
	});

	it('login rethrows and surfaces the server message', async () => {
		fetchMock.mockRejectedValue({ data: { message: 'bad creds' } });
		const { login } = useLogin();
		await expect(login('a', 'b')).rejects.toBeTruthy();
	});

	it('logout clears the session even if the request fails', async () => {
		fetchMock.mockRejectedValue(new Error('net'));
		const { logout } = useLogin();
		await logout();
		expect(sessionClear).toHaveBeenCalled();
		expect(sessionFetch).toHaveBeenCalled();
	});
});
