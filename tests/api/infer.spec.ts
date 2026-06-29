import { expect, test } from '../fixtures';
import { createAdapter, publishAdapter, uploadAssets } from '../utils/adapters';
import { loginViaApi } from '../utils/auth';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

// publish an adapter as admin, then exercise the widget budget anonymously
test.describe('inference api', () => {
	test('admin (unlimited tester) gets a response and bypasses the budget', async ({ request }) => {
		const { id } = await createAdapter(request);
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		// admin bypasses the per-hour budget; many streamed calls all succeed
		for (let i = 0; i < 5; i++) {
			const res = await request.post('/api/infer/widget', {
				data: { adapterId: id, prompt: `hello ${i}` }
			});
			expect(res.ok()).toBe(true);
			// widget now streams SSE; the body carries the mock response frames
			const body = await res.text();
			expect(body).toContain('[mock');
		}
	});

	test('anonymous public budget returns 429 after the prompt cap', async ({
		request,
		playwright
	}) => {
		// pin a deterministic small public cap (server state persists across runs)
		await loginViaApi(request);
		await request.post('/api/settings', {
			data: {
				rateLimits: {
					public: { promptsPerHour: 2, outputTokensPerHour: 1000, precedence: 'prompts' },
					developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
				}
			}
		});

		const { id } = await createAdapter(request, { slug: `infer-pub-${Date.now()}` });
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		// fresh anonymous context; cap is 2 prompts/hour so a 429 must appear within a few calls
		const anon = await playwright.request.newContext({ baseURL: BASE });
		let sawLimit = false;
		for (let i = 0; i < 8; i++) {
			const res = await anon.post('/api/infer/widget', {
				data: { adapterId: id, prompt: `anon prompt ${i} ${Date.now()}` }
			});
			if (res.status() === 429) {
				sawLimit = true;
				break;
			}
		}
		expect(sawLimit).toBe(true);
		await anon.dispose();

		// restore the default public budget
		await request.post('/api/settings', {
			data: {
				rateLimits: {
					public: { promptsPerHour: 3, outputTokensPerHour: 1600, precedence: 'tokens' },
					developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' }
				}
			}
		});
	});

	test('models endpoint lists lora-capable base models', async ({ request }) => {
		const res = await request.get('/api/infer/models');
		expect(res.ok()).toBe(true);
		const models = await res.json();
		expect(Array.isArray(models)).toBe(true);
		expect(models.length).toBeGreaterThan(0);
		expect(models[0]).toHaveProperty('model');
		expect(models[0]).toHaveProperty('modelType');
	});

	test('playground runs a base model with no adapter attached', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/infer/playground', {
			data: {
				baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
				messages: [{ role: 'user', content: 'hello base' }]
			}
		});
		expect(res.ok()).toBe(true);
		const body = await res.text();
		// the mock stream tags base-only runs with "base:" (no lora)
		expect(body).toContain('base:');
		expect(body).toContain('[DONE]');
	});

	test('playground rejects an unknown base model', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/infer/playground', {
			data: { baseModel: '@cf/not/a-real-model', messages: [{ role: 'user', content: 'hi' }] }
		});
		expect(res.status()).toBe(400);
	});

	test('playground requires an adapter or a base model', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/infer/playground', {
			data: { messages: [{ role: 'user', content: 'hi' }] }
		});
		expect(res.status()).toBe(400);
	});

	test('summarize condenses text for authed users', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/infer/summarize', {
			data: { text: 'user: hello there\nassistant: hi, how can i help\nuser: tell me about loras' }
		});
		expect(res.ok()).toBe(true);
		const json = await res.json();
		expect(typeof json.summary).toBe('string');
		expect(json.summary.length).toBeGreaterThan(0);
	});

	test('summarize requires auth and a non-empty body', async ({ request, playwright }) => {
		// anonymous is rejected
		const anon = await playwright.request.newContext({ baseURL: BASE });
		const unauth = await anon.post('/api/infer/summarize', { data: { text: 'hello world' } });
		expect(unauth.status()).toBe(401);
		await anon.dispose();

		// authed but empty text is a 400
		await loginViaApi(request);
		const empty = await request.post('/api/infer/summarize', { data: { text: '   ' } });
		expect(empty.status()).toBe(400);
	});

	test('playground runs a published adapter (lora attached)', async ({ request }) => {
		const { id } = await createAdapter(request);
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		const res = await request.post('/api/infer/playground', {
			data: { adapterId: id, messages: [{ role: 'user', content: 'hello lora' }] }
		});
		expect(res.ok()).toBe(true);
		const body = await res.text();
		// adapter runs tag with "lora:" so a compare against base is visibly different
		expect(body).toContain('lora:');
	});

	test('inference analytics records runs by model and audience', async ({ request }) => {
		await loginViaApi(request); // admin -> developer audience
		const { id } = await createAdapter(request);
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		const res = await request.post('/api/infer/widget', {
			data: { adapterId: id, prompt: 'hello analytics' }
		});
		expect(res.ok()).toBe(true);
		await res.text(); // drain the stream so the post-response flush records the inference

		// recording is best-effort after the response; poll the admin summary until it lands
		await expect
			.poll(
				async () => {
					const s = await (await request.get('/api/analytics/summary?range=7d')).json();
					return s?.inferences?.total ?? 0;
				},
				{ timeout: 10_000 }
			)
			.toBeGreaterThan(0);

		const summary = await (await request.get('/api/analytics/summary?range=7d')).json();
		expect(summary.inferences.byAudience.developer).toBeGreaterThan(0);
		expect(Object.keys(summary.inferences.byModel).length).toBeGreaterThan(0);
		expect(summary.inferences.perDay.length).toBeGreaterThan(0);
	});
});
