import { chromium, type FullConfig } from '@playwright/test';

const TEST_ADMIN = { username: 'admin', password: 'adminpass' };

async function ping(url: string) {
	try {
		const res = await fetch(url, { method: 'GET' });
		return res.ok;
	} catch {
		return false;
	}
}

// warm every route in a real browser so vite compiles each client bundle once, up front.
// fetch()-warming only compiles the server render; the first browser visit still pays the
// client-bundle compile - which, on a loaded 2-core CI runner, can blow past a test's 90s
// timeout and turn a cold-compile into a flaky failure (see the 404/error.vue case).
export default async function globalSetup(_config: FullConfig) {
	const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

	// wait until the server is up
	const deadline = Date.now() + 240_000;
	while (Date.now() < deadline) {
		if (await ping(`${base}/api/settings`)) break;
		await new Promise((r) => setTimeout(r, 1000));
	}

	// trigger db init; admin is auto-seeded from NUXT_PASSWORD on first hit
	await fetch(`${base}/api/settings`, { method: 'GET' });

	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({ baseURL: base });

		// authenticate in-context so the authed routes (dashboard/admin/etc) compile too
		const login = await context.request.post('/api/login', { data: TEST_ADMIN });
		if (!login.ok()) {
			throw new Error(`Test admin login failed: ${login.status()} ${await login.text()}`);
		}

		const page = await context.newPage();
		// every route a UI spec touches, plus a 404 to compile error.vue's shell (UApp + layout).
		// dynamic routes use a real+bogus target so [slug]/[username] compile both paths.
		const routes = [
			'/',
			'/about',
			'/tags',
			'/playground',
			'/dashboard',
			'/dashboard/cloudflare',
			'/dashboard/settings',
			'/dashboard/analytics',
			'/dashboard/training',
			'/dashboard/machines',
			'/dashboard/profile',
			'/admin/users',
			'/profile',
			'/authors/admin',
			'/adapters/__warmup_nonexistent__'
		];
		for (const r of routes) {
			try {
				await page.goto(r, { waitUntil: 'domcontentloaded', timeout: 120_000 });
				// let client modules finish compiling/hydrating (best-effort; a 404 never sets it)
				await page
					.waitForFunction(() => document.documentElement.dataset.hydrated === 'true', null, {
						timeout: 60_000
					})
					.catch(() => {});
			} catch {
				// ignore warmup failures - the point is to pay the compile cost, not to assert
			}
		}
		await context.close();
	} finally {
		await browser.close();
	}
}
