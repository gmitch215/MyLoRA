import { expect, test } from './fixtures';

// broad smoke pass: public routes must render without a server error
const PUBLIC_ROUTES = ['/', '/about', '/tags'];

test.describe('smoke', () => {
	for (const route of PUBLIC_ROUTES) {
		test(`renders ${route} without error`, async ({ page }) => {
			const res = await page.goto(route, { waitUntil: 'domcontentloaded' });
			expect(res?.status(), `status for ${route}`).toBeLessThan(400);
			// the error page renders this heading; ensure we did not land on it
			await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
		});
	}
});
