import { createAdapter, deleteAdapter, publishAdapter, uploadAssets } from '../utils/adapters';
import { loginViaApi } from '../utils/auth';
import { expect, test } from './fixtures';

test.describe('adapters api', () => {
	test('full lifecycle: create -> upload -> listed -> publish -> published', async ({
		request
	}) => {
		const { id, slug } = await createAdapter(request);

		// status is draft until both assets are present
		let status = await (await request.get(`/api/adapters/${id}/status`)).json();
		expect(status.status).toBe('draft');

		await uploadAssets(request, id);
		status = await (await request.get(`/api/adapters/${id}/status`)).json();
		expect(status.status).toBe('listed');

		await publishAdapter(request, id);
		// mock cloudflare resolves the push quickly; poll briefly
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		const found = await (await request.get(`/api/adapters/find?slug=${slug}`)).json();
		expect(found.slug).toBe(slug);
		expect(found.status).toBe('published');

		await deleteAdapter(request, id);
	});

	test('rejects rank above the cloudflare maximum', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/adapters/create', {
			data: {
				name: 'bad-rank',
				slug: `bad-rank-${Date.now()}`,
				baseModel: '@cf/mistralai/mistral-7b-instruct-v0.2-lora',
				modelType: 'mistral',
				rank: 64,
				tags: [],
				examples: [],
				visibility: 'public'
			}
		});
		expect(res.status()).toBe(400);
	});

	test('slug uniqueness is enforced', async ({ request }) => {
		const a = await createAdapter(request, { slug: `dup-${Date.now()}` });
		const b = await createAdapter(request, { slug: a.slug });
		// the server appends a suffix to keep slugs unique
		expect(b.slug).not.toBe(a.slug);
		await deleteAdapter(request, a.id);
		await deleteAdapter(request, b.id);
	});

	test('public list excludes drafts', async ({ request, playwright }) => {
		const { id } = await createAdapter(request);
		// check the feed anonymously; owners do see their own drafts, the public does not
		const anon = await playwright.request.newContext({
			baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787'
		});
		const list = await (await anon.get('/api/adapters/list')).json();
		const found = list.items.find((x: any) => x.id === id);
		expect(found).toBeUndefined();
		await anon.dispose();
		await deleteAdapter(request, id);
	});

	test('published adapter allows metadata edits but rejects real model changes', async ({
		request
	}) => {
		const { id } = await createAdapter(request);
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		// re-saving the SAME model fields (as the edit form always sends them) plus a new icon must pass
		const ok = await request.patch('/api/adapters/update', {
			data: {
				id,
				baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
				modelType: 'mistral',
				rank: 8,
				iconName: 'mdi:robot',
				iconColor: '#22cc88'
			}
		});
		expect(ok.ok()).toBe(true);
		expect((await ok.json()).iconName).toBe('mdi:robot');

		// actually changing the rank on a published adapter is still blocked
		const blocked = await request.patch('/api/adapters/update', {
			data: { id, rank: 16 }
		});
		expect(blocked.status()).toBe(409);

		await deleteAdapter(request, id);
	});

	test('persists an iconify icon + color and round-trips them', async ({ request }) => {
		await loginViaApi(request);
		const slug = `icon-${Date.now()}`;
		const res = await request.post('/api/adapters/create', {
			data: {
				name: slug,
				slug,
				description: 'icon test',
				baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
				modelType: 'mistral',
				rank: 8,
				tags: [],
				examples: [],
				iconName: 'mdi:scale-balance',
				iconColor: 'primary'
			}
		});
		expect(res.ok()).toBe(true);
		const { id } = await res.json();

		const found = await (await request.get(`/api/adapters/find?slug=${slug}`)).json();
		expect(found.iconName).toBe('mdi:scale-balance');
		expect(found.iconColor).toBe('primary');

		// a custom hex also round-trips through update
		const upd = await request.patch('/api/adapters/update', {
			data: { id, iconColor: '#ff8800' }
		});
		expect(upd.ok()).toBe(true);
		expect((await upd.json()).iconColor).toBe('#ff8800');

		await deleteAdapter(request, id);
	});
});
