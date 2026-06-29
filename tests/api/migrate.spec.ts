import { expect, test } from '../fixtures';
import { loginViaApi } from '../utils/auth';

// an account id starting with 16 'a's makes the cloudflare mock report two existing finetunes;
// the rest is randomized so the unique account_id index is not violated across runs
function sentinelAccountId() {
	const suffix = `${Date.now().toString(16)}${Math.floor(Math.random() * 1e8).toString(16)}`;
	return ('aaaaaaaaaaaaaaaa' + suffix).slice(0, 32).padEnd(32, '0');
}

test.describe('cloudflare account migration', () => {
	test('adding an account imports its finetunes as testable migrated adapters', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const create = await request.post('/api/cf-accounts/create', {
			data: {
				label: `migrate-${Date.now()}`,
				accountId: sentinelAccountId(),
				apiToken: 'migrate-token-0123456789',
				tokenScope: 'readwrite',
				shared: true,
				isDefault: false
			}
		});
		expect(create.ok()).toBe(true);
		const account = await create.json();
		// raw token never leaks; the import count is reported
		expect(account.apiToken).toBeUndefined();
		expect(account.imported).toBeGreaterThanOrEqual(2);

		// the migrated adapters are publicly visible in the grid (even anonymously)
		const anon = await playwright.request.newContext({
			baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787'
		});
		const list = await (await anon.get('/api/adapters/list?pageSize=100')).json();
		const migrated = list.items.filter((a: any) => a.status === 'migrated');
		expect(migrated.length).toBeGreaterThanOrEqual(2);

		// migrated adapters host no files (download disabled) but carry a finetune name to test with
		const sample = migrated[0];
		expect(sample.weightsBytes).toBe(0);
		expect(sample.finetuneName).toBeTruthy();

		// playground requires auth; anon is rejected (not because it is "untestable")
		const anonInfer = await anon.post('/api/infer/playground', {
			data: { adapterId: sample.id, messages: [{ role: 'user', content: 'hi' }] }
		});
		expect([401, 403]).toContain(anonInfer.status());
		await anon.dispose();

		// an authed playground run against the migrated adapter streams a response
		const authed = await request.post('/api/infer/playground', {
			data: { adapterId: sample.id, messages: [{ role: 'user', content: 'hi' }] }
		});
		expect(authed.ok()).toBe(true);
	});
});
