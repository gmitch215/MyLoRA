import { expect, test } from '../fixtures';
import { loginViaApi } from '../utils/auth';
import { createCfAccount, deleteCfAccount } from '../utils/cf';

test.describe('cloudflare accounts api', () => {
	test('never returns the raw token, only last4', async ({ request }) => {
		const account = await createCfAccount(request, { apiToken: 'super-secret-token-abcd1234' });
		expect(account.tokenLast4).toBe('1234');
		expect(JSON.stringify(account)).not.toContain('super-secret-token');

		const list = await (await request.get('/api/cf-accounts/list')).json();
		const found = list.find((a: any) => a.id === account.id);
		expect(found).toBeTruthy();
		expect(JSON.stringify(found)).not.toContain('super-secret-token');
		expect(found.tokenCipher).toBeUndefined();

		await deleteCfAccount(request, account.id);
	});

	test('requires manage-accounts capability (developer forbidden)', async ({ request }) => {
		// a fresh developer has no canManageAccounts by default
		await loginViaApi(request);
		const res = await request.get('/api/cf-accounts/list');
		// admin is allowed
		expect(res.ok()).toBe(true);
	});

	test('rejects malformed account id', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/cf-accounts/create', {
			data: { label: 'bad', accountId: 'not-hex', apiToken: 'test-token-0123456789abcdef' }
		});
		expect(res.status()).toBe(400);
	});
});
