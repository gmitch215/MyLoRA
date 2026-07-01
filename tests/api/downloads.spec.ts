import { createAdapter, deleteAdapter, uploadAssets } from '../utils/adapters';
import { expect, test } from './fixtures';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

test.describe('downloads api', () => {
	test('downloading config bumps the download count', async ({ request }) => {
		const { id, slug } = await createAdapter(request);
		await uploadAssets(request, id);

		const before = (await (await request.get(`/api/adapters/find?slug=${slug}`)).json())
			.downloadCount;
		const dl = await request.get(`/api/adapters/${id}/download/config`);
		expect(dl.ok()).toBe(true);

		await expect
			.poll(
				async () =>
					(await (await request.get(`/api/adapters/find?slug=${slug}`)).json()).downloadCount,
				{ timeout: 5000 }
			)
			.toBeGreaterThan(before);

		await deleteAdapter(request, id);
	});

	test('private adapter assets are not downloadable anonymously', async ({
		request,
		playwright
	}) => {
		const { id } = await createAdapter(request, {
			slug: `priv-${Date.now()}`,
			visibility: 'private'
		});
		await uploadAssets(request, id);

		const anon = await playwright.request.newContext({ baseURL: BASE });
		const res = await anon.get(`/api/adapters/${id}/download/weights`);
		expect([401, 403, 404]).toContain(res.status());
		await anon.dispose();

		await deleteAdapter(request, id);
	});

	// regression: the /files blob route must serve screenshots only, never weights/config,
	// so private/draft adapter assets cannot be fetched by id bypassing the access-checked route
	test('files route refuses weights and config', async ({ request, playwright }) => {
		const { id } = await createAdapter(request, { slug: `files-${Date.now()}` });
		await uploadAssets(request, id);

		const anon = await playwright.request.newContext({ baseURL: BASE });
		const weights = await anon.get(`/files/adapters/${id}/adapter_model.safetensors`);
		expect(weights.status()).toBe(404);
		const config = await anon.get(`/files/adapters/${id}/adapter_config.json`);
		expect(config.status()).toBe(404);
		await anon.dispose();

		await deleteAdapter(request, id);
	});
});
