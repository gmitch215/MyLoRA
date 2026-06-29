import { expect, test } from './fixtures';
import { createAdapter, publishAdapter, uploadAssets } from './utils/adapters';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

test.describe('playground', () => {
	test('streams a response, meters context, and branches on edit', async ({
		page,
		context,
		request
	}) => {
		await loginContext(context);
		const { id } = await createAdapter(request, { slug: `pg-${Date.now()}` });
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		const prompt = page.getByPlaceholder(/message the model/i);
		await expect(prompt).toBeVisible();
		await prompt.fill('hello there');
		await prompt.press('Enter');

		// the mock stream tags assistant output with [mock ...]; it must render into the chat
		await expect(page.getByText(/\[mock/i).first()).toBeVisible({ timeout: 10_000 });

		// context meter + export controls appear once a conversation exists
		await expect(page.getByText(/tokens/i).first()).toBeVisible();
		await expect(page.getByRole('button', { name: /copy conversation/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /download conversation/i })).toBeVisible();

		// edit-and-resend: hovering the user turn reveals the edit action; saving branches a new version
		await page.getByText('hello there', { exact: true }).hover();
		await page
			.getByRole('button', { name: /edit message/i })
			.first()
			.click();
		await page.locator('textarea:not([placeholder])').fill('a different prompt');
		await page.getByRole('button', { name: /save & resend/i }).click();
		await expect(page.getByText('a different prompt', { exact: true })).toBeVisible({
			timeout: 10_000
		});

		// the original turn is kept as a branch; nav shows 2/2 and switching back restores it
		await expect(page.getByText('2/2')).toBeVisible();
		const prev = page.getByRole('button', { name: /previous version/i });
		await expect(prev).toBeEnabled({ timeout: 10_000 });
		await prev.click();
		await expect(page.getByText('hello there', { exact: true })).toBeVisible();
	});

	test('persists conversation history across reloads', async ({ page, context }) => {
		// no adapter needed; the playground always has a base model selectable as the default target
		await loginContext(context);

		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		const prompt = page.getByPlaceholder(/message the model/i);
		await prompt.fill('remember me');
		await prompt.press('Enter');
		await expect(page.getByText(/\[mock/i).first()).toBeVisible({ timeout: 10_000 });

		// reload: the playground rehydrates the saved conversation from localStorage
		await page.reload({ waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByText('remember me', { exact: true })).toBeVisible({ timeout: 10_000 });
	});

	test('compare mode diffs the two responses', async ({ page, context, request }) => {
		await loginContext(context);
		const { id } = await createAdapter(request, { slug: `pg-cmp-${Date.now()}` });
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		// switch to compare (defaults to a lora vs its base model)
		await page.getByRole('button', { name: 'Compare', exact: true }).click();
		const prompt = page.getByPlaceholder(/message both targets/i);
		await prompt.fill('compare this');
		await prompt.press('Enter');
		await expect(page.getByText(/\[mock/i).first()).toBeVisible({ timeout: 10_000 });

		// the diff viewer opens and renders the inline diff of both answers
		const compare = page.getByRole('button', { name: /compare text/i });
		await expect(compare).toBeVisible({ timeout: 10_000 });
		await compare.click();
		await expect(page.getByText(/compare responses/i)).toBeVisible();
		// side-by-side diff legend + a turn block render
		await expect(page.getByText(/only in/i).first()).toBeVisible();
		await expect(page.getByText(/turn 1/i)).toBeVisible();
	});
});
