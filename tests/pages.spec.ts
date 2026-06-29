import { expect, test } from './fixtures';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// broad authed-page coverage; admin sees every area
test.describe('authed pages', () => {
	test.beforeEach(async ({ context }) => {
		await loginContext(context);
	});

	test('playground renders with the chat surface', async ({ page }) => {
		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/playground/i).first()).toBeVisible();
	});

	test('profile page renders the profile form', async ({ page }) => {
		await page.goto('/profile', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('textbox').first()).toBeVisible();
	});

	test('admin users page renders the users table', async ({ page }) => {
		await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/users/i).first()).toBeVisible();
	});

	test('analytics dashboard renders', async ({ page }) => {
		await page.goto('/dashboard/analytics', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/analytics/i).first()).toBeVisible();
	});

	test('author profile page renders for admin', async ({ page }) => {
		await page.goto('/authors/admin', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText(/team|admin/i).first()).toBeVisible();
	});
});
