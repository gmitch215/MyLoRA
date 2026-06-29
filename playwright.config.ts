import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const isCI = !!process.env.CI;
const COVERAGE = process.env.COVERAGE === '1';

const SETUP = process.env.PLAYWRIGHT_SETUP === '1';
const BASE_URL = SETUP
	? process.env.PLAYWRIGHT_SETUP_BASE_URL || 'http://127.0.0.1:8788'
	: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

const baseReporters: any[] = [['list']];
if (isCI) baseReporters.push(['github']);

const reporters: any[] =
	COVERAGE && !SETUP
		? [
				...baseReporters,
				[
					'monocart-reporter',
					{
						name: 'MyLoRA E2E',
						outputFile: './coverage/report.html',
						coverage: {
							name: 'MyLoRA Coverage',
							outputDir: './coverage',
							reports: [['lcovonly', { file: 'lcov.info' }], 'console-summary'],
							entryFilter: (entry: { url: string }) => {
								const url = entry.url || '';
								if (!url) return false;
								if (url.includes('node_modules')) return false;
								if (url.includes('/_nuxt/builds/')) return false;
								if (url.startsWith('chrome-extension:')) return false;
								return url.includes('/_nuxt/') || url.startsWith(BASE_URL);
							},
							sourceFilter: (path: string) => path.includes('src/')
						}
					}
				]
			]
		: SETUP
			? baseReporters
			: [...baseReporters, ['html', { open: 'never', outputFolder: 'playwright-report' }]];

export default defineConfig({
	testDir: './tests',
	// main run ignores the isolated setup flow; setup run targets only it (fresh unseeded server)
	...(SETUP
		? { testMatch: ['**/setup.spec.ts'] }
		: { testIgnore: ['**/utils/**', '**/fixtures/**', '**/fixtures.ts', '**/setup.spec.ts'] }),
	fullyParallel: false,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: reporters,
	outputDir: 'playwright-results',
	// the setup run needs no admin-seeding global setup (it tests the no-admin-yet path)
	...(SETUP
		? {}
		: {
				globalSetup: fileURLToPath(new URL('./tests/utils/global-setup.ts', import.meta.url))
			}),
	webServer: SETUP
		? {
				// dev:setup wipes .data-setup on boot, so reuse:false guarantees a clean first-run instance
				command: 'bun run dev:setup',
				url: BASE_URL,
				reuseExistingServer: false,
				timeout: 240_000,
				stdout: 'pipe',
				stderr: 'pipe'
			}
		: {
				command: 'bun run dev:test',
				url: BASE_URL,
				reuseExistingServer: !isCI,
				timeout: 240_000,
				stdout: 'pipe',
				stderr: 'pipe'
			},
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 20_000,
		navigationTimeout: 90_000
	},
	projects: [
		{
			name: SETUP ? 'setup' : 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
