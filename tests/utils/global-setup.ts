import type { FullConfig } from '@playwright/test';

const TEST_ADMIN = { username: 'admin', password: 'adminpass' };

async function ping(url: string) {
	try {
		const res = await fetch(url, { method: 'GET' });
		return res.ok;
	} catch {
		return false;
	}
}

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

	// verify the seeded admin can log in
	const login = await fetch(`${base}/api/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(TEST_ADMIN)
	});
	if (!login.ok) {
		throw new Error(`Test admin login failed: ${login.status} ${await login.text()}`);
	}

	// warm the dev server so vite compiles each route before the timed tests run
	const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
	const routes = [
		'/',
		'/about',
		'/tags',
		'/playground',
		'/dashboard',
		'/dashboard/cloudflare',
		'/dashboard/settings',
		'/dashboard/analytics',
		'/admin/users',
		'/profile'
	];
	for (const r of routes) {
		try {
			await fetch(`${base}${r}`, { headers: cookie ? { cookie } : {} });
		} catch {
			// ignore warmup failures
		}
	}
}
