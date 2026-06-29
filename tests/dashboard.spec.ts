import { expect, test } from './fixtures';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

test.describe('dashboard', () => {
	test.beforeEach(async ({ context }) => {
		await loginContext(context);
	});

	test('my adapters dashboard loads', async ({ page }) => {
		await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/my adapters/i).first()).toBeVisible();
	});

	test('cloudflare accounts page loads for admin', async ({ page }) => {
		await page.goto('/dashboard/cloudflare', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/cloudflare/i).first()).toBeVisible();
	});

	test('settings page loads for admin', async ({ page }) => {
		await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/settings/i).first()).toBeVisible();
	});
});
