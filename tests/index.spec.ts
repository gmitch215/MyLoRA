import { expect, test } from './fixtures';
import { createAdapter, uploadAssets } from './utils/adapters';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

test.describe('home page', () => {
	test('tag query filters the grid and is preserved in the url', async ({
		page,
		context,
		request
	}) => {
		// log the browser in so the grid's client fetch bypasses the 30s public cache (fresh adapters)
		await loginContext(context);
		const tag = `e2e-${Date.now()}`;
		const name = `Tagged Adapter ${Date.now()}`;
		const { id } = await createAdapter(request, {
			name,
			slug: `tagged-${Date.now()}`,
			tags: [tag]
		});
		await uploadAssets(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('listed');

		// navigating with ?tag used to collapse back to '/'; it must now persist and filter the grid
		await page.goto(`/?tag=${tag}`, { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		await expect(page).toHaveURL(new RegExp(`tag=${tag}`));
		await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
	});

	test('renders the site name and grid shell', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		// the navbar shows the configured site name
		await expect(page.getByText(/mylora/i).first()).toBeVisible();
	});

	test('hydrates and exposes navigation', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		// playground + about links live in the navbar
		await expect(page.getByRole('link', { name: /about/i }).first()).toBeVisible();
	});

	test('shows a log in affordance when logged out', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('button', { name: /log in/i }).first()).toBeVisible();
	});
});
