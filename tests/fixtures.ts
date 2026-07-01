import { test as baseTest, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const COVERAGE = process.env.COVERAGE === '1';

// auto-fixture that starts/stops chromium V8 coverage when COVERAGE=1
export const test = baseTest.extend<{ autoCoverage: void }>({
	autoCoverage: [
		async ({ page, browserName }, use, testInfo) => {
			const shouldCollect = COVERAGE && browserName === 'chromium';
			if (shouldCollect) {
				await page.coverage.startJSCoverage({ resetOnNavigation: false });
			}
			await use();
			if (shouldCollect) {
				// never let coverage teardown fail an otherwise-green test: if the test itself timed
				// out, stopJSCoverage throws "Test ended" and would surface as a confusing failure.
				// a page that never navigated (url still about:blank) has no coverage worth gathering.
				try {
					if (page.url() === 'about:blank') return;
					const coverage = await page.coverage.stopJSCoverage();
					if (coverage.length > 0) await addCoverageReport(coverage, testInfo);
				} catch {
					// swallow - collection is best-effort, correctness of the test is not
				}
			}
		},
		{ auto: true }
	]
});

export { expect };
