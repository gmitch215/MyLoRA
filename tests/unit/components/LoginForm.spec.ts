import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginForm from '~/components/LoginForm.vue';

// the component captures useAuthStore() from the mounted app's pinia, so mock the import directly
const login = vi.fn();
mockNuxtImport('useAuthStore', () => () => ({ login }));

beforeEach(() => {
	login.mockReset();
});

async function fill(w: any, user: string, pass: string) {
	const inputs = w.findAll('input');
	await inputs[0]!.setValue(user);
	await inputs[1]!.setValue(pass);
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe('LoginForm', () => {
	it('shows a validation error when fields are empty', async () => {
		const w = await mountSuspended(LoginForm);
		await w.findComponent({ name: 'UButton' }).trigger('click');
		expect(w.text()).toContain('Username and password are required');
		expect(login).not.toHaveBeenCalled();
	});

	it('logs in and emits success on ok', async () => {
		login.mockResolvedValue({ ok: true });
		const w = await mountSuspended(LoginForm);
		await fill(w, 'greg', 'pw');
		await w.findComponent({ name: 'UButton' }).trigger('click');
		await flush();
		expect(login).toHaveBeenCalledWith('greg', 'pw');
		expect(w.emitted('success')).toBeTruthy();
		expect(w.text()).toContain('Successfully Logged In');
		expect(w.text()).toContain('Logged in');
	});

	it('shows invalid credentials when login returns not ok', async () => {
		login.mockResolvedValue({ ok: false });
		const w = await mountSuspended(LoginForm);
		await fill(w, 'greg', 'bad');
		await w.findComponent({ name: 'UButton' }).trigger('click');
		await flush();
		expect(w.text()).toContain('Invalid credentials');
	});

	it('maps a 401 error to invalid credentials', async () => {
		login.mockRejectedValue({ statusCode: 401 });
		const w = await mountSuspended(LoginForm);
		await fill(w, 'greg', 'x');
		await w.findComponent({ name: 'UButton' }).trigger('click');
		await flush();
		expect(w.text()).toContain('Invalid credentials');
	});

	it('maps a 400 error to a missing credentials message', async () => {
		login.mockRejectedValue({ status: 400, data: { statusMessage: 'Missing username' } });
		const w = await mountSuspended(LoginForm);
		await fill(w, 'greg', 'x');
		await w.findComponent({ name: 'UButton' }).trigger('click');
		await flush();
		expect(w.text()).toContain('Missing username');
	});

	it('falls back to a generic error for other failures', async () => {
		login.mockRejectedValue({ statusCode: 500 });
		const w = await mountSuspended(LoginForm);
		await fill(w, 'greg', 'x');
		await w.findComponent({ name: 'UButton' }).trigger('click');
		await flush();
		expect(w.text()).toContain('An error occurred');
	});

	it('submits on Enter keypress', async () => {
		login.mockResolvedValue({ ok: true });
		const w = await mountSuspended(LoginForm);
		await fill(w, 'greg', 'pw');
		await w.findAll('input')[0]!.trigger('keypress', { key: 'Enter' });
		await flush();
		expect(login).toHaveBeenCalled();
	});
});
