import { loginViaApi } from '../utils/auth';
import { expect, test } from './fixtures';

test.describe('settings api', () => {
	test('public get returns defaults for structured sections', async ({ request }) => {
		const res = await request.get('/api/settings');
		expect(res.ok()).toBe(true);
		const s = await res.json();
		expect(s.access).toBeTruthy();
		expect(s.permissions?.developer).toBeTruthy();
		expect(s.rateLimits?.public).toBeTruthy();
		expect(s.features).toBeTruthy();
	});

	test('public rate limits are clamped to their ranges on save', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/settings', {
			data: {
				rateLimits: {
					public: { promptsPerHour: 9999, outputTokensPerHour: 9999999, precedence: 'tokens' },
					developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
				}
			}
		});
		expect(res.ok()).toBe(true);
		const s = await res.json();
		// public caps: prompts <= 10, output tokens <= 10000
		expect(s.rateLimits.public.promptsPerHour).toBeLessThanOrEqual(10);
		expect(s.rateLimits.public.outputTokensPerHour).toBeLessThanOrEqual(10000);
		// developer tier stays unlimited (0)
		expect(s.rateLimits.developer.promptsPerHour).toBe(0);

		// restore defaults so other specs see the documented public budget
		await request.post('/api/settings', {
			data: {
				rateLimits: {
					public: { promptsPerHour: 3, outputTokensPerHour: 1600, precedence: 'tokens' },
					developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
				}
			}
		});
	});

	test('saves with a blank theme color and blank banner text (both optional)', async ({
		request
	}) => {
		await loginViaApi(request);
		// the form submits empty strings for untouched branding fields; these must not block the save
		const res = await request.post('/api/settings', {
			data: { themeColor: '', message: { text: '', type: 'info', icon: '' } }
		});
		expect(res.ok()).toBe(true);
		const s = await res.json();
		// a blank-text banner is normalized to "no banner"
		expect(s.message ?? null).toBeNull();
	});

	test('persists the permission matrix', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/settings', {
			data: {
				permissions: {
					developer: {
						canCreate: true,
						canEditOwn: true,
						canEditAny: false,
						canDeleteOwn: false,
						canDeleteAny: false,
						canPublish: true,
						canManageAccounts: false,
						canManageMachines: false,
						canTrain: true,
						unlimitedTester: false
					},
					manager: {
						canCreate: true,
						canEditOwn: true,
						canEditAny: true,
						canDeleteOwn: false,
						canDeleteAny: false,
						canPublish: true,
						canManageAccounts: true,
						canManageMachines: true,
						canTrain: true,
						unlimitedTester: true
					}
				}
			}
		});
		expect(res.ok()).toBe(true);
		const s = await res.json();
		expect(s.permissions.developer.canPublish).toBe(true);
		// restore the default (developers cannot publish)
		await request.post('/api/settings', {
			data: {
				permissions: {
					developer: {
						canCreate: true,
						canEditOwn: true,
						canEditAny: false,
						canDeleteOwn: false,
						canDeleteAny: false,
						canPublish: false,
						canManageAccounts: false,
						canManageMachines: false,
						canTrain: true,
						unlimitedTester: false
					},
					manager: {
						canCreate: true,
						canEditOwn: true,
						canEditAny: true,
						canDeleteOwn: false,
						canDeleteAny: false,
						canPublish: true,
						canManageAccounts: true,
						canManageMachines: true,
						canTrain: true,
						unlimitedTester: true
					}
				}
			}
		});
	});

	test('an uploaded favicon never rides in the public settings payload', async ({ request }) => {
		await loginViaApi(request);
		// a ~1.5 MB data url is what a real uploaded png looks like once base64-encoded
		const dataUrl = `data:image/png;base64,${'A'.repeat(1_500_000)}`;
		const save = await request.post('/api/settings', {
			data: { favicon: dataUrl, faviconPng: dataUrl }
		});
		expect(save.ok()).toBe(true);
		const saved = await save.json();
		expect(saved.faviconPng).toBe('/favicon.png?v=custom');

		const pub = await request.get('/api/settings');
		const body = await pub.text();
		expect(body.length).toBeLessThan(20_000);
		expect(JSON.parse(body).favicon).toBe('/favicon.ico?v=custom');

		// the form posts the placeholder back unchanged: that must not overwrite the upload
		const resave = await request.post('/api/settings', {
			data: { favicon: saved.favicon, faviconPng: saved.faviconPng, name: 'Favicon Keeper' }
		});
		expect(resave.ok()).toBe(true);
		const served = await request.get('/favicon.png');
		expect(served.headers()['content-type']).toContain('image/png');
		expect((await served.body()).length).toBeGreaterThan(1_000_000);

		// clear it so later specs see the stock icon
		await request.post('/api/settings', { data: { favicon: '', faviconPng: '' } });
	});

	test('serve tooling defaults to installing missing tools and round-trips a change', async ({
		request
	}) => {
		const stock = {
			autoInstall: true,
			pythonVersion: '3.11',
			vllmVersion: '0.31.0',
			cloudflaredVersion: '2026.10.0',
			downloadRetries: 5,
			networkWaitMinutes: 10,
			bandwidthLimitKbps: 0
		};
		await loginViaApi(request);
		await request.post('/api/settings', { data: { tooling: stock } });
		expect((await (await request.get('/api/settings')).json()).tooling).toEqual(stock);

		const changed = {
			...stock,
			autoInstall: false,
			vllmVersion: '0.30.0',
			bandwidthLimitKbps: 250
		};
		const save = await request.post('/api/settings', { data: { tooling: changed } });
		expect(save.ok()).toBe(true);
		expect((await save.json()).tooling).toEqual(changed);
		expect((await (await request.get('/api/settings')).json()).tooling).toEqual(changed);

		await request.post('/api/settings', { data: { tooling: stock } });
	});

	test('refuses tooling values that could reach a shell or fall outside their range', async ({
		request
	}) => {
		await loginViaApi(request);
		const stock = {
			autoInstall: true,
			pythonVersion: '3.11',
			vllmVersion: '0.31.0',
			cloudflaredVersion: '2026.10.0',
			downloadRetries: 5,
			networkWaitMinutes: 10,
			bandwidthLimitKbps: 0
		};
		for (const bad of [
			{ vllmVersion: '0.31.0; touch /tmp/x' },
			{ pythonVersion: '3.11 && id' },
			{ cloudflaredVersion: 'latest' },
			{ downloadRetries: 0 },
			{ networkWaitMinutes: 500 },
			{ bandwidthLimitKbps: -1 }
		]) {
			const res = await request.post('/api/settings', { data: { tooling: { ...stock, ...bad } } });
			expect(res.status(), JSON.stringify(bad)).toBe(400);
		}
		expect((await (await request.get('/api/settings')).json()).tooling.vllmVersion).toBe('0.31.0');
	});
});
