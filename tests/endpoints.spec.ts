import { expect, test } from './fixtures';
import { loginContext, loginViaApi } from './utils/auth';
import { waitForHydration } from './utils/hydration';
import { createNgrokToken, removeNgrokTokens } from './utils/ngrok';

test.describe('endpoints page', () => {
	test.beforeEach(async ({ context }) => {
		await loginContext(context);
	});

	test('adds, tests and deletes an endpoint', async ({ page }) => {
		const label = `UI Endpoint ${Date.now()}`;
		await page.goto('/dashboard/endpoints', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('heading', { name: 'Endpoints' }).first()).toBeVisible();

		await page.getByRole('button', { name: 'Add Endpoint' }).click();
		await page.getByLabel('Label').fill(label);
		await page.getByLabel('Base URL').fill('https://ui.mock.test/v1');
		await page.getByLabel('API Key').fill('sk-ui-key-9876');
		await page.getByRole('button', { name: 'Add Endpoint' }).last().click();

		const row = page.getByRole('row', { name: new RegExp(label) });
		await expect(row).toBeVisible();
		await expect(row.getByText('...9876')).toBeVisible();

		await row.getByRole('button', { name: 'Test Endpoint' }).click();
		await expect(row.getByText('OK', { exact: true })).toBeVisible();

		await row.getByRole('button', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
		await expect(page.getByRole('row', { name: new RegExp(label) })).toHaveCount(0);
	});

	test('rejects an unsafe url with the reason', async ({ page }) => {
		await page.goto('/dashboard/endpoints', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Add Endpoint' }).click();
		await page.getByLabel('Label').fill('Bad');
		await page.getByLabel('Base URL').fill('https://127.0.0.1/v1');
		await page.getByRole('button', { name: 'Add Endpoint' }).last().click();
		await expect(page.getByText('Use a hostname, not an IP address')).toBeVisible();
	});

	test('opens the vLLM serve form with the tunnel choices', async ({ page }) => {
		await page.goto('/dashboard/endpoints', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Serve With vLLM' }).click();
		await expect(page.getByText('Runs On Your Machine')).toBeVisible();
		await expect(page.getByLabel('Base Model')).toBeVisible();
		await expect(page.getByText('A missing tunnel tool is installed on first use')).toBeVisible();
	});

	test('the serve form offers every ngrok token source and hides it for cloudflared', async ({
		page,
		request
	}) => {
		await loginViaApi(request);
		const token = await createNgrokToken(request, { label: `Serve Choice ${Date.now()}` });
		await page.goto('/dashboard/endpoints', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Serve With vLLM' }).click();

		const select = page.getByRole('combobox', { name: 'ngrok Token' });
		await expect(select).toBeVisible();
		await expect(select).toContainText('Automatic');
		await select.click();
		for (const name of ['Automatic', "The Machine's Own Sign In", 'Server Token', token.label]) {
			await expect(page.getByRole('option', { name })).toBeVisible();
		}
		await page.keyboard.press('Escape');

		await page.getByRole('combobox', { name: 'Tunnel' }).click();
		await page.getByRole('option', { name: 'Cloudflare Tunnel (cloudflared)' }).click();
		await expect(page.getByRole('combobox', { name: 'ngrok Token' })).toHaveCount(0);
		await removeNgrokTokens(request, [token.id]);
	});

	test('adds, defaults and deletes an ngrok token without ever showing it', async ({ page }) => {
		const label = `UI Token ${Date.now()}`;
		const secret = `ngrok_ui_${Date.now()}_abcdefghijkl9876`;
		await page.goto('/dashboard/endpoints', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('heading', { name: 'ngrok Tokens' })).toBeVisible();
		await expect(page.getByText('This server also has its own token')).toBeVisible();

		await page.getByRole('button', { name: 'Add Token' }).click();
		await page.getByLabel('Label').fill(label);
		await page.getByLabel('Authtoken').fill(secret);
		await page.getByRole('button', { name: 'Save Token' }).click();

		const row = page.getByRole('row', { name: new RegExp(label) });
		await expect(row).toBeVisible();
		await expect(row.getByText('...9876')).toBeVisible();
		await expect(page.getByText(secret)).toHaveCount(0);
		await expect(row.getByText('personal')).toBeVisible();

		await row.getByRole('button', { name: 'Make Default' }).click();
		await expect(row.getByText('default', { exact: true })).toBeVisible();
		await row.getByRole('button', { name: 'Remove Default' }).click();
		await expect(row.getByText('default', { exact: true })).toHaveCount(0);

		await row.getByRole('button', { name: 'Delete Token' }).click();
		await expect(page.getByRole('row', { name: new RegExp(label) })).toHaveCount(0);
	});

	test('a bad token shows the reason and saves nothing', async ({ page }) => {
		await page.goto('/dashboard/endpoints', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Add Token' }).click();
		await page.getByLabel('Label').fill('Too Short');
		await page.getByLabel('Authtoken').fill('short');
		await page.getByRole('button', { name: 'Save Token' }).click();
		await expect(page.getByText(/Token looks too short/)).toBeVisible();
		await expect(page.getByRole('row', { name: /Too Short/ })).toHaveCount(0);
	});

	test('the dashboard sidebar links to it', async ({ page }) => {
		await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('link', { name: 'Endpoints' }).first()).toBeVisible();
	});
});
