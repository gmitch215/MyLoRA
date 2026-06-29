import { expect, test } from '../fixtures';
import { createAdapter, deleteAdapter, uploadAssets } from '../utils/adapters';

test.describe('install.sh', () => {
	test('emits a wrangler install script for an adapter with files', async ({ request }) => {
		const { id, slug } = await createAdapter(request, { slug: `install-${Date.now()}` });
		await uploadAssets(request, id);

		const res = await request.get(`/adapters/${slug}/install.sh`);
		expect(res.ok()).toBe(true);
		expect(res.headers()['content-type']).toContain('shell');

		const body = await res.text();
		expect(body).toContain('wrangler ai finetune create');
		expect(body).toContain(`/api/adapters/${id}/download/config`);
		expect(body).toContain(`/api/adapters/${id}/download/weights`);
		expect(body).toContain('@cf/mistral/mistral-7b-instruct-v0.2-lora');

		await deleteAdapter(request, id);
	});

	test('404s for an unknown slug', async ({ request }) => {
		const res = await request.get('/adapters/definitely-not-a-real-slug/install.sh');
		expect(res.status()).toBe(404);
	});

	test('409s before any files are uploaded', async ({ request }) => {
		const { id, slug } = await createAdapter(request, { slug: `install-empty-${Date.now()}` });
		const res = await request.get(`/adapters/${slug}/install.sh`);
		expect(res.status()).toBe(409);
		await deleteAdapter(request, id);
	});
});
