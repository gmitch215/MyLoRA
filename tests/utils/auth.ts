import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

export const TEST_ADMIN = { username: 'admin', password: 'adminpass' };

export async function loginViaApi(
	request: APIRequestContext,
	creds: { username: string; password: string } = TEST_ADMIN
) {
	// skip a redundant login if the persisted session already matches (avoids tripping the auth limiter)
	try {
		const v = await request.get('/api/verify');
		if (v.ok()) {
			const body = await v.json();
			if (body?.loggedIn && body?.user?.username === creds.username) return v;
		}
	} catch {
		// fall through to a fresh login
	}
	const res = await request.post('/api/login', { data: creds });
	if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
	return res;
}

export async function loginUi(page: Page, creds = TEST_ADMIN) {
	await page.goto('/?login=1');
	await page.getByPlaceholder('Username').fill(creds.username);
	await page.getByPlaceholder('Password').fill(creds.password);
	await page.getByRole('button', { name: /^login$/i }).click();
}

export async function loginContext(context: BrowserContext, creds = TEST_ADMIN): Promise<void> {
	// retry once; the dev server can briefly stall under sustained/coverage load
	let lastErr: unknown;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await context.request.post('/api/login', { data: creds, timeout: 30_000 });
			if (res.ok()) return;
			lastErr = new Error(`context login failed: ${res.status()}`);
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr;
}
