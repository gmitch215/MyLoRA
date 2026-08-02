import { expect, test } from './fixtures';
import { createAdapter, publishAdapter, uploadAssets } from './utils/adapters';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// runs only under the `mobile` project (Pixel 7: 412x915, isMobile + hasTouch)

async function open(page: import('@playwright/test').Page, path: string) {
	await page.goto(path, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
}

// every element whose box escapes the viewport; `html,body{overflow-x:hidden}` used to mask these
async function overflowing(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const width = document.documentElement.clientWidth;
		const out: string[] = [];
		document.querySelectorAll('*').forEach((el) => {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && (r.right > width + 1 || r.left < -1)) {
				const cls = (el.getAttribute('class') || '').slice(0, 60);
				out.push(
					`${el.tagName.toLowerCase()}.${cls} [${Math.round(r.left)}..${Math.round(r.right)}]`
				);
			}
		});
		return out;
	});
}

test.describe('mobile layout', () => {
	test('public pages fit the viewport with no horizontal overflow', async ({ page }) => {
		for (const path of ['/', '/tags', '/about']) {
			await open(page, path);
			const doc = await page.evaluate(() => ({
				scrollWidth: document.documentElement.scrollWidth,
				clientWidth: document.documentElement.clientWidth,
				// the global suppressor is gone; overflow must be genuinely absent
				overflowX: getComputedStyle(document.body).overflowX
			}));
			expect(doc.overflowX, `${path} must not rely on a global overflow suppressor`).not.toBe(
				'hidden'
			);
			expect(await overflowing(page), `${path} has elements past the viewport`).toEqual([]);
			expect(doc.scrollWidth, `${path} scrolls horizontally`).toBeLessThanOrEqual(
				doc.clientWidth + 1
			);
		}
	});

	test('the navbar has real horizontal padding and stays a single row of controls', async ({
		page
	}) => {
		await open(page, '/');
		const nav = page.locator('#navbar');
		const box = await nav.boundingBox();
		const padding = await nav.evaluate((el) => {
			const s = getComputedStyle(el);
			return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight) };
		});
		expect(padding.left).toBeGreaterThan(0);
		expect(padding.right).toBeGreaterThan(0);

		// the old 2-col grid stacked 5 buttons into 3 rows and tripled the header height
		expect(box!.height).toBeLessThan(140);
	});

	test('adapter detail keeps long model ids and the install command inside the page', async ({
		page,
		request
	}) => {
		const slug = `mob-${Date.now()}`;
		const { id } = await createAdapter(request, { slug });
		await uploadAssets(request, id);

		await open(page, `/adapters/${slug}`);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		expect(await overflowing(page)).toEqual([]);
	});

	test('wide tables scroll inside their own container with a visible scrollbar', async ({
		page,
		context
	}) => {
		await loginContext(context);
		await open(page, '/admin/users');

		const scroller = page.locator('div.overflow-x-auto:has(> table)').first();
		await expect(scroller).toBeVisible();

		const box = await scroller.evaluate((el) => ({
			// scrollbar-hide sets scrollbar-width:none and removes the only cue that this scrolls
			cueHidden: getComputedStyle(el).scrollbarWidth === 'none',
			scrolls: el.scrollWidth > el.clientWidth,
			width: el.clientWidth
		}));
		expect(box.cueHidden, 'the scroll cue must not be hidden on a real scroll container').toBe(
			false
		);
		expect(box.scrolls, 'the table must actually overflow its wrapper here').toBe(true);
		// the wide table is contained by the wrapper; the page itself must not scroll sideways
		expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
		const doc = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth
		}));
		expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);
	});

	test('chat message actions are reachable without hover', async ({ page, context, request }) => {
		await loginContext(context);
		const { id } = await createAdapter(request, { slug: `mob-chat-${Date.now()}` });
		await uploadAssets(request, id);
		await publishAdapter(request, id);
		await expect
			.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
				timeout: 10_000
			})
			.toBe('published');

		await open(page, '/playground');
		const prompt = page.getByPlaceholder(/message the model/i);
		await prompt.fill('touch reachability');
		await prompt.press('Enter');
		await expect(page.getByText(/\[mock/i).first()).toBeVisible({ timeout: 10_000 });

		// on a touch device there is no hover, so the copy action must already be visible+tappable
		const copy = page.getByRole('button', { name: /copy message/i }).first();
		await expect(copy).toBeVisible();
		await expect(copy).not.toHaveCSS('opacity', '0');
		await copy.tap();
	});

	test('a form modal keeps its side gutters', async ({ page, context }) => {
		await loginContext(context);
		await open(page, '/admin/users');
		await page.getByRole('button', { name: /new user/i }).tap();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		const box = await dialog.boundingBox();
		const width = page.viewportSize()!.width;
		// a bare `w-full` overrides nuxt ui's w-[calc(100vw-2rem)] and goes edge to edge
		expect(box!.x, 'modal must not touch the left edge').toBeGreaterThan(0);
		expect(box!.x + box!.width, 'modal must not touch the right edge').toBeLessThan(width);
	});

	test('the versus panel stacks its two agent cards and fits the viewport', async ({
		page,
		context
	}) => {
		await loginContext(context);
		await open(page, '/playground');
		await page.getByRole('button', { name: 'Versus', exact: true }).tap();

		await expect(page.getByRole('log', { name: /versus transcript/i })).toBeVisible();
		const a = await page.getByLabel('Agent A Target').boundingBox();
		const b = await page.getByLabel('Agent B Target').boundingBox();
		// stacked, not side by side
		expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
		expect(await overflowing(page)).toEqual([]);
	});

	test('the skip link reaches main content', async ({ page }) => {
		await open(page, '/');
		const skip = page.getByRole('link', { name: /skip to content/i });
		await expect(skip).toBeAttached();
		await expect(page.locator('#main-content')).toBeAttached();
		expect(await page.getAttribute('html', 'lang')).toBe('en');
	});

	test('honors prefers-reduced-motion', async ({ browser }) => {
		// the app ships animate-spin, animate-bounce and view transitions; none may run for a
		// viewer who asked for reduced motion
		const context = await browser.newContext({ reducedMotion: 'reduce' });
		const page = await context.newPage();
		await open(page, '/');

		const stillAnimating = await page.evaluate(() => {
			const spinner = document.createElement('div');
			spinner.className = 'animate-spin';
			const bouncer = document.createElement('div');
			bouncer.className = 'animate-bounce';
			document.body.append(spinner, bouncer);
			const running = [spinner, bouncer]
				.filter((el) => {
					const s = getComputedStyle(el);
					// the reduce block collapses duration to ~0 and drops the spin animation
					return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.05;
				})
				.map((el) => el.className);
			spinner.remove();
			bouncer.remove();
			return running;
		});
		expect(stillAnimating).toEqual([]);

		await context.close();
	});
});
