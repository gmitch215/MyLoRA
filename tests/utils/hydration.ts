import type { Page } from '@playwright/test';

// wait until the app has hydrated (see src/plugins/hydration-marker.client.ts) before interacting
export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true', null, {
		timeout: 15_000
	});
}
