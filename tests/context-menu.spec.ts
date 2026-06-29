import { expect, test } from './fixtures';
import { createAdapter, deleteAdapter, uploadAssets } from './utils/adapters';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

test.describe('adapter context menu', () => {
	test('right-clicking a card shows its actions (admin sees edit/delete)', async ({
		page,
		context,
		request
	}) => {
		await loginContext(context);
		const name = `Ctx ${Date.now()}`;
		const { id } = await createAdapter(request, { name, slug: `ctx-${Date.now()}` });
		await uploadAssets(request, id); // -> listed, so it shows in the public grid

		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		await page.getByText(name).first().click({ button: 'right' });

		await expect(page.getByRole('menuitem', { name: /^Open$/ })).toBeVisible({ timeout: 5000 });
		await expect(page.getByRole('menuitem', { name: /Copy Link/i })).toBeVisible();
		// admin has canEditAny / canDeleteAny
		await expect(page.getByRole('menuitem', { name: /^Edit$/ })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: /^Delete$/ })).toBeVisible();

		await deleteAdapter(request, id);
	});
});
