import { expect, test } from './fixtures';
import { waitForHydration } from './utils/hydration';

// full first-run lifecycle, run against an isolated unseeded server via `bun run test:setup`
// (PLAYWRIGHT_SETUP=1 switches playwright.config.ts to the dev:setup server on 8788). order matters: every "fresh"
// assertion must precede the one successful admin creation, after which the instance is locked.

const ADMIN = {
	username: 'owner',
	displayName: 'Owner Team',
	password: 'supersecret123',
	bio: 'the first administrator'
};

test.describe('setup first-run flow', () => {
	test('fresh instance reports it needs setup', async ({ request }) => {
		const res = await request.get('/api/setup/status');
		expect(res.ok()).toBe(true);
		const s = await res.json();
		expect(s.needsSetup).toBe(true);
		expect(s.userCount).toBe(0);
	});

	test('an un-set-up instance forces every route to /setup', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await expect(page).toHaveURL(/\/setup$/);
		await waitForHydration(page);
		await expect(page.getByRole('heading', { name: /welcome to mylora/i })).toBeVisible();
	});

	test('client validation blocks weak or mismatched credentials before any insert', async ({
		page
	}) => {
		await page.goto('/setup', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		const submit = page.getByRole('button', { name: /create administrator/i });
		const passwords = page.locator('input[type="password"]');

		// default form has an empty password -> too short (match the full error, not the field hint)
		await submit.click();
		await expect(page.getByText(/password must be at least 8 characters/i)).toBeVisible();

		// matching length but mismatched confirmation
		await passwords.nth(0).fill('longenough1');
		await passwords.nth(1).fill('different222');
		await submit.click();
		await expect(page.getByText(/passwords do not match/i)).toBeVisible();

		// nothing leaked through: still un-set-up
		const status = await page.request.get('/api/setup/status');
		expect((await status.json()).needsSetup).toBe(true);
	});

	test('the server rejects a reserved username without creating an admin', async ({ request }) => {
		const res = await request.post('/api/setup/init', {
			data: {
				username: 'root',
				displayName: 'Root',
				password: 'supersecret123',
				bio: ''
			}
		});
		expect(res.status()).toBe(400);
		expect(await res.text()).toMatch(/reserved/i);
		// still no admin, still no session granted
		const status = await request.get('/api/setup/status');
		expect((await status.json()).needsSetup).toBe(true);
		const verify = await request.get('/api/verify');
		expect((await verify.json()).loggedIn).toBe(false);
	});

	test('completes the full flow: creates the admin, logs in, persists advanced settings', async ({
		page
	}) => {
		await page.goto('/setup', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		await page.getByPlaceholder('admin').fill(ADMIN.username);
		await page.getByPlaceholder('Your name or team name').fill(ADMIN.displayName);
		const passwords = page.locator('input[type="password"]');
		await passwords.nth(0).fill(ADMIN.password);
		await passwords.nth(1).fill(ADMIN.password);
		await page.locator('textarea').fill(ADMIN.bio);

		// open advanced config and set in-range public limits (the inputs enforce min/max client-side,
		// so out-of-range values would block submit; api-level clamping is covered in settings.spec)
		await page.getByRole('button', { name: /advanced configuration/i }).click();
		const numbers = page.locator('input[type="number"]');
		await numbers.nth(0).fill('8'); // public prompts/hour (1-10)
		await numbers.nth(1).fill('8000'); // public output tokens/hour (1000-10000)

		await page.getByRole('button', { name: /create administrator/i }).click();

		// lands on home, no longer trapped on /setup (client-side nav on a cold dev server, so poll)
		await expect(page).toHaveURL(/\/$/, { timeout: 45_000 });

		// the new admin is now authenticated
		const verify = await (await page.request.get('/api/verify')).json();
		expect(verify.loggedIn).toBe(true);
		expect(verify.user.username).toBe(ADMIN.username);
		expect(verify.user.role).toBe('administrator');

		// status flips to completed with exactly one user
		const status = await (await page.request.get('/api/setup/status')).json();
		expect(status.needsSetup).toBe(false);
		expect(status.userCount).toBe(1);

		// advanced settings flowed through buildSettings + persisted, and the permission matrix
		// persisted at its default (developers cannot publish, managers can)
		const settings = await (await page.request.get('/api/settings')).json();
		expect(settings.rateLimits.public.promptsPerHour).toBe(8);
		expect(settings.rateLimits.public.outputTokensPerHour).toBe(8000);
		expect(settings.permissions.developer.canPublish).toBe(false);
		expect(settings.permissions.manager.canPublish).toBe(true);
	});

	test('a stranger cannot re-run setup to seize control once completed', async ({ request }) => {
		// re-init is locked even with no session
		const res = await request.post('/api/setup/init', {
			data: {
				username: 'intruder',
				displayName: 'Intruder',
				password: 'takeover12345',
				bio: ''
			}
		});
		expect(res.status()).toBe(409);

		// the rejected attempt granted no session
		const verify = await (await request.get('/api/verify')).json();
		expect(verify.loggedIn).toBe(false);

		// and the legitimate admin is untouched (still exactly one user)
		const status = await (await request.get('/api/setup/status')).json();
		expect(status.needsSetup).toBe(false);
		expect(status.userCount).toBe(1);
	});

	test('the setup page redirects away once the instance is configured', async ({ page }) => {
		await page.goto('/setup', { waitUntil: 'domcontentloaded' });
		await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
		expect(new URL(page.url()).pathname).toBe('/');
	});
});
