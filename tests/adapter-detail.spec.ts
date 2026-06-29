import { expect, test } from './fixtures';
import { createAdapter, publishAdapter, uploadAssets } from './utils/adapters';
import { waitForHydration } from './utils/hydration';

test.describe('adapter detail', () => {
	test('renders a published adapter with downloads and the tester', async ({ page, request }) => {
		// seed a published, public adapter via the api
		const name = `Detail Test ${Date.now()}`;
		const { id, slug } = await createAdapter(request, { name, slug: `detail-${Date.now()}` });
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		await page.goto(`/adapters/${slug}`, { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		await expect(page.getByText(name).first()).toBeVisible();
		// download affordances for the two assets
		await expect(
			page.getByRole('link', { name: /weights|config|download/i }).first()
		).toBeVisible();
		// the inference widget prompt is present for a published adapter (public tester access)
		await expect(page.getByRole('textbox').first()).toBeVisible();
	});

	test('returns 404 for an unknown slug', async ({ page }) => {
		const res = await page.goto('/adapters/this-slug-does-not-exist-xyz', {
			waitUntil: 'domcontentloaded'
		});
		expect(res?.status()).toBe(404);
	});
});
