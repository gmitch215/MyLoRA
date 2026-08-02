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

	test('renders assistant markdown as styled html, not raw text or one word per line', async ({
		page,
		context
	}) => {
		await loginContext(context);
		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);

		// the mock echoes the prompt back, so whatever markdown goes in comes out as assistant output
		await page
			.getByPlaceholder(/message the model/i)
			// the mock prefixes "[mock ...] ", so the heading needs a line of its own to stay line-initial
			.fill(
				'Intro.\n\n## Smaller\n\nHard\nwrapped\nprose\nflows. Some **bold** and *italic*.\n\n- one\n- two'
			);
		await page.getByPlaceholder(/message the model/i).press('Enter');
		await expect(page.getByText(/\[mock/i).first()).toBeVisible({ timeout: 10_000 });

		const bubble = page.locator('.prose').last();
		const rendered = await bubble.evaluate((el) => {
			const cs = (node: Element | null) => (node ? getComputedStyle(node) : null);
			const h2 = el.querySelector('h2');
			const ul = el.querySelector('ul');
			return {
				// regression: breaks:true turned every hard wrap into a <br>
				brCount: el.querySelectorAll('br').length,
				// regression: the prose classes were inert without @tailwindcss/typography, so
				// preflight left headings at body size and stripped list markers
				bodySize: parseFloat(cs(el)!.fontSize),
				h2Size: h2 ? parseFloat(cs(h2)!.fontSize) : 0,
				h2Weight: h2 ? cs(h2)!.fontWeight : '',
				strongWeight: cs(el.querySelector('strong'))?.fontWeight ?? '',
				emStyle: cs(el.querySelector('em'))?.fontStyle ?? '',
				listStyle: ul ? cs(ul)!.listStyleType : '',
				items: el.querySelectorAll('li').length
			};
		});

		expect(rendered.brCount, 'hard wraps must not become <br>').toBe(0);
		expect(rendered.h2Size, 'headings must be larger than body text').toBeGreaterThan(
			rendered.bodySize
		);
		expect(Number(rendered.h2Weight)).toBeGreaterThanOrEqual(600);
		expect(Number(rendered.strongWeight)).toBeGreaterThanOrEqual(600);
		expect(rendered.emStyle).toBe('italic');
		expect(rendered.listStyle, 'list markers must survive preflight').toBe('disc');
		expect(rendered.items).toBe(2);

		// the raw markdown syntax must not be visible in the rendered output
		await expect(bubble).not.toContainText('**bold**');
		await expect(bubble).not.toContainText('## Smaller');
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

	test('versus runs a bounded back-and-forth between two targets', async ({
		page,
		context,
		request
	}) => {
		await loginContext(context);
		const { id } = await createAdapter(request, { slug: `pg-vs-${Date.now()}` });
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Versus', exact: true }).click();

		// the debate preset pre-fills opposed personas on both sides
		await expect(page.getByLabel('Agent A Persona')).toHaveValue(/Argue FOR/);
		await expect(page.getByLabel('Agent B Persona')).toHaveValue(/Argue AGAINST/);

		const each = page.getByLabel('Messages Each');
		await expect(each).toHaveAttribute('min', '1');
		await expect(each).toHaveAttribute('max', '10');
		await each.fill('2');
		await page.getByLabel('Topic').fill('tabs or spaces');

		await page.getByRole('button', { name: /start match/i }).click();

		// 2 each = 4 messages, alternating; the run ends on its own
		const thread = page.getByRole('log', { name: /versus transcript/i });
		// surface the reason first: a malformed conversation (roles not alternating from `user`)
		// aborts the run mid-way, and "#4 not found" would not say why
		await expect(page.getByRole('button', { name: /start match/i })).toBeVisible({
			timeout: 30_000
		});
		await expect(page.getByText('Match Failed')).toBeHidden();
		await expect(thread.getByText(/#4/)).toBeVisible();
		await expect(page.getByText('Message 4 of 4')).toBeVisible();

		// the mock tags lora vs base output, so the two sides are distinguishable
		await expect(thread.getByText(/\[mock lora:/).first()).toBeVisible();
		await expect(thread.getByText(/\[mock base:/).first()).toBeVisible();
		await expect(thread.getByText('tabs or spaces').first()).toBeVisible();

		// export controls appear once a transcript exists
		await expect(page.getByRole('button', { name: /copy transcript/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /download transcript/i })).toBeVisible();
	});

	test('versus keeps a partial transcript when stopped mid-run and after a reload', async ({
		page,
		context
	}) => {
		await loginContext(context);
		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Versus', exact: true }).click();

		await page.getByLabel('Messages Each').fill('10');
		await page.getByLabel('Topic').fill('a long argument');
		await page.getByRole('button', { name: /start match/i }).click();

		// stop as soon as the first message lands
		const thread = page.getByRole('log', { name: /versus transcript/i });
		await expect(thread.getByText(/#1/)).toBeVisible({ timeout: 20_000 });
		await page.getByRole('button', { name: /^stop$/i }).click();

		await expect(page.getByText('Match Stopped', { exact: false })).toBeVisible({
			timeout: 20_000
		});
		await expect(thread.getByText(/\[mock/).first()).toBeVisible();
		// stopping must not have reached the full 20-message run
		expect(await thread.getByText(/^#\d+$/).count()).toBeLessThan(20);

		// the partial match survives a reload
		await page.reload({ waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(
			page
				.getByRole('log', { name: /versus transcript/i })
				.getByText(/\[mock/)
				.first()
		).toBeVisible({ timeout: 20_000 });
	});

	test('versus refuses to start without a topic and clears a finished match', async ({
		page,
		context
	}) => {
		await loginContext(context);
		await page.goto('/playground', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Versus', exact: true }).click();

		const start = page.getByRole('button', { name: /start match/i });
		await page.getByLabel('Topic').fill('');
		await expect(start).toBeDisabled();

		await page.getByLabel('Messages Each').fill('1');
		await page.getByLabel('Topic').fill('quick one');
		await expect(start).toBeEnabled();
		await start.click();

		const thread = page.getByRole('log', { name: /versus transcript/i });
		await expect(thread.getByText(/#2/)).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: /^clear$/i }).click();
		await expect(thread.getByText(/pick two targets/i)).toBeVisible();
	});
});
