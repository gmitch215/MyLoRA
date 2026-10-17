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

	test('only links the svg favicon when the favicon is an iconify id', async ({ page }) => {
		const missing: string[] = [];
		page.on('response', (res) => {
			if (res.status() === 404) missing.push(new URL(res.url()).pathname);
		});
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.locator('link[href="/favicon.svg"]')).toHaveCount(0);
		expect(missing).not.toContain('/favicon.svg');
	});

	test('the log in button keeps its name when the label is hidden on a narrow screen', async ({
		page
	}) => {
		await page.setViewportSize({ width: 375, height: 700 });
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.locator('button[aria-label="Log In"]')).toBeVisible();
	});

	test('adapter cards head their title at level 2 under the page h1', async ({
		page,
		context,
		request
	}) => {
		await loginContext(context);
		const { id } = await createAdapter(request, { name: `Heading Adapter ${Date.now()}` });
		await uploadAssets(request, id);
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
		await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
		await expect(page.locator('a[href^="/adapters/"] h3')).toHaveCount(0);
	});
});
