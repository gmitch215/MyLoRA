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
});
