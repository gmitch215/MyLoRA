import { expect, test } from '../fixtures';
import { loginViaApi } from '../utils/auth';
import { createUser, deleteUser } from '../utils/users';

test.describe('admin users api', () => {
	test('admin can list users', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.get('/api/admin/users');
		expect(res.ok()).toBe(true);
		const list = await res.json();
		expect(Array.isArray(list)).toBe(true);
		expect(list.some((u: any) => u.username === 'admin')).toBe(true);
		// the shape uses adapterCount, not postCount
		expect(list[0]).toHaveProperty('adapterCount');
	});

	test('can create and delete a developer', async ({ request }) => {
		const user = await createUser(request, { role: 'developer' });
		expect(user.id).toBeTruthy();
		const list = await (await request.get('/api/admin/users')).json();
		const found = list.find((u: any) => u.id === user.id);
		expect(found?.role).toBe('developer');
		await deleteUser(request, user.id);
	});

	test('non-admin cannot access the admin users api', async ({ request, playwright }) => {
		const dev = await createUser(request, { role: 'developer' });
		const ctx = await playwright.request.newContext({
			baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787'
		});
		await ctx.post('/api/login', { data: { username: dev.username, password: dev.password } });
		const res = await ctx.get('/api/admin/users');
		expect(res.status()).toBe(403);
		await ctx.dispose();
		await deleteUser(request, dev.id);
	});
});
