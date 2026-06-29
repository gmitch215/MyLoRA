import { expect, test } from './fixtures';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

test.describe('command palette', () => {
	test('opens with Ctrl+K and lists commands', async ({ page, context }) => {
		await loginContext(context);
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		await page.keyboard.press('Control+k');
		await expect(page.getByPlaceholder(/jump anywhere/i)).toBeVisible({ timeout: 5000 });
		// a gated nav command shows for a logged-in admin
		await expect(page.getByRole('option', { name: /Dashboard/i }).first()).toBeVisible();
	});

	test('the navbar search button opens the palette', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page
			.getByRole('button', { name: /command palette|search/i })
			.first()
			.click();
		await expect(page.getByPlaceholder(/jump anywhere/i)).toBeVisible({ timeout: 5000 });
	});

	test('selecting a command closes the palette and navigates; g-chords work once closed', async ({
		page
	}) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		// pick a nav command: it must navigate AND auto-close (no lingering over the destination)
		await page.keyboard.press('Control+k');
		await expect(page.getByPlaceholder(/jump anywhere/i)).toBeVisible({ timeout: 5000 });
		await page.getByRole('option', { name: /Tags/i }).first().click();
		await expect(page).toHaveURL(/\/tags$/, { timeout: 5000 });
		await expect(page.getByPlaceholder(/jump anywhere/i)).toBeHidden();

		// palette closed + body focused: a global g-chord navigates (router.push from the handler)
		await page.getByRole('heading', { level: 1 }).click();
		await page.keyboard.press('g');
		await page.waitForTimeout(60);
		await page.keyboard.press('h');
		await expect(page).toHaveURL(/127\.0\.0\.1:8787\/$/, { timeout: 5000 });
	});
});
