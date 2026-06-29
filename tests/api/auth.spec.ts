import { expect, test } from '../fixtures';
import { TEST_ADMIN } from '../utils/auth';

test.describe('auth api', () => {
	test('rejects bad credentials', async ({ request }) => {
		const res = await request.post('/api/login', {
			data: { username: 'admin', password: 'wrong-password' }
		});
		expect(res.status()).toBe(401);
	});

	test('login + verify round-trip for admin', async ({ request }) => {
		const login = await request.post('/api/login', { data: TEST_ADMIN });
		expect(login.ok()).toBe(true);
		const body = await login.json();
		expect(body.ok).toBe(true);
		expect(body.user?.username).toBe('admin');
		expect(body.user?.role).toBe('administrator');

		const verify = await request.get('/api/verify');
		const v = await verify.json();
		expect(v.loggedIn).toBe(true);
		expect(v.user?.role).toBe('administrator');
	});

	test('logout clears the session', async ({ request }) => {
		await request.post('/api/login', { data: TEST_ADMIN });
		await request.post('/api/logout');
		const verify = await request.get('/api/verify');
		const v = await verify.json();
		expect(v.loggedIn).toBe(false);
	});
});
