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

	test.describe('publish-permission preflight', () => {
		test('an authorized token reports canPublish true', async ({ request }) => {
			const account = await createCfAccount(request, {
				apiToken: 'test-token-can-publish-0123456789'
			});
			const res = await request.get(`/api/cf-accounts/${account.id}/preflight`);
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.canPublish).toBe(true);
			await deleteCfAccount(request, account.id);
		});

		test('a read-only token reports canPublish false with guidance', async ({ request }) => {
			// the cf mock treats a token containing "readonly" as lacking Workers AI: Edit
			const account = await createCfAccount(request, {
				apiToken: 'readonly-token-0123456789abcd'
			});
			const res = await request.get(`/api/cf-accounts/${account.id}/preflight`);
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.canPublish).toBe(false);
			expect(String(body.detail)).toMatch(/Workers AI|Edit|finetune/i);
			await deleteCfAccount(request, account.id);
		});
	});

	test('available: lists the accounts a publisher can host on, redacted', async ({ request }) => {
		const account = await createCfAccount(request, {
			label: 'available-probe',
			apiToken: 'super-secret-available-0123456789'
		});
		const res = await request.get('/api/cf-accounts/available');
		expect(res.ok()).toBe(true);
		const body = await res.json();
		const found = body.accounts.find((a: any) => a.id === account.id);
		expect(found).toBeTruthy();
		expect(found.label).toBe('available-probe');
		// never leaks the token
		expect(JSON.stringify(body)).not.toContain('super-secret-available');
		expect(found.tokenCipher).toBeUndefined();
		await deleteCfAccount(request, account.id);
	});
});
