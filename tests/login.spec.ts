import { expect, test } from './fixtures';
import { TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

test.describe('login', () => {
	// both paths in one navigation: dev-mode vite stalls on back-to-back full reloads
	test('ui login rejects a bad password then accepts the real one', async ({ page }) => {
		await page.goto('/?login=1', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		// wrong password keeps us logged out
		await page.getByPlaceholder('Username').first().fill('admin');
		await page.getByPlaceholder('Password').first().fill('definitely-wrong');
		await page.getByRole('button', { name: /^login$/i }).click();
		await expect(page.getByRole('link', { name: /dashboard/i })).toHaveCount(0);

		// the real password logs in and reveals the dashboard entry
		await page.getByPlaceholder('Password').first().fill(TEST_ADMIN.password);
		await page.getByRole('button', { name: /^login$/i }).click();
		await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible({
			timeout: 15_000
		});
	});
});
