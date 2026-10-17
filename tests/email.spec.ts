import { expect, test } from './fixtures';
import { loginContext } from './utils/auth';
import { waitForHydration } from './utils/hydration';
import {
	clearSink,
	confirmedSubscriber,
	disableMail,
	enableMail,
	linkIn,
	readSink,
	removeTestSubscribers,
	uniqueEmail,
	uniqueIp
} from './utils/mail';

test.describe.configure({ mode: 'serial' });

test.describe('email subscriptions ui', () => {
	test.afterEach(async ({ request }) => {
		await removeTestSubscribers(request);
		await disableMail(request);
	});

	test('the footer form is hidden while mail is off', async ({ page, request }) => {
		await disableMail(request);
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByLabel('Get New Adapters by Email')).toHaveCount(0);
	});

	test('subscribe, confirm from the email link, then unsubscribe', async ({ page, request }) => {
		await enableMail(request);
		await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
		const email = uniqueEmail();

		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		const input = page.getByLabel('Get New Adapters by Email');
		await expect(input).toBeVisible();
		await input.fill(email);
		await page.getByRole('button', { name: 'Subscribe' }).click();
		await expect(page.getByText('Check your email to confirm your subscription.')).toBeVisible();

		const confirmMail = (await readSink(request)).find((m) => m.to === email)!;
		const confirm = linkIn(confirmMail, '/subscribe/confirm');
		await page.goto(`${confirm.pathname}${confirm.search}`, { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Confirm Subscription' }).click();
		await expect(page.getByRole('heading', { name: 'You Are Subscribed' })).toBeVisible();

		await clearSink(request);
		const sub = await confirmedSubscriber(request);
		const unsubscribe = new URL(
			`/unsubscribe?id=${sub.id}&token=${await tokenFor(request, sub.id)}`,
			'http://x'
		);
		await page.goto(`${unsubscribe.pathname}${unsubscribe.search}`, {
			waitUntil: 'domcontentloaded'
		});
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Unsubscribe' }).click();
		await expect(page.getByRole('heading', { name: 'You Are Unsubscribed' })).toBeVisible();
	});

	test('a bad link explains itself', async ({ page }) => {
		await page.goto('/subscribe/confirm?id=nope&token=nope', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await page.getByRole('button', { name: 'Confirm Subscription' }).click();
		await expect(page.getByRole('heading', { name: 'Could Not Confirm' })).toBeVisible();
	});
});

// the unsubscribe token only ever travels in an email, so read it from the next adapter mail's link
async function tokenFor(request: import('@playwright/test').APIRequestContext, id: string) {
	const { createAdapter, publishAdapter, uploadAssets } = await import('./utils/adapters');
	const adapter = await createAdapter(request);
	await uploadAssets(request, adapter.id);
	await publishAdapter(request, adapter.id);
	await expect
		.poll(async () => (await (await request.get('/api/admin/mail')).json()).outbox.pending)
		.toBeGreaterThan(0);
	await request.post('/api/admin/mail/drain');
	const mail = (await readSink(request)).find((m) => m.text.includes('/unsubscribe?id=' + id))!;
	return new URL(mail.text.match(/https?:\/\/[^\s]*\/unsubscribe\?[^\s]*/)![0]).searchParams.get(
		'token'
	)!;
}

test.describe('email admin and profile ui', () => {
	test.beforeEach(async ({ context }) => {
		await loginContext(context);
	});

	test('the admin email page shows settings and subscribers', async ({ page, request }) => {
		await enableMail(request);
		const sub = await confirmedSubscriber(request);
		await page.goto('/admin/email', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('heading', { name: 'Email Delivery' })).toBeVisible();
		await expect(page.getByText(sub.email)).toBeVisible();
		await removeTestSubscribers(request);
		await disableMail(request);
	});

	test('the profile saves an email and the job email switch', async ({ page, request }) => {
		await enableMail(request);
		await page.goto('/profile', { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		const email = uniqueEmail('me');
		await page.getByLabel('Email', { exact: true }).fill(email);
		await page.getByRole('switch', { name: 'Email Me About Training Jobs' }).click();
		await page.getByRole('button', { name: 'Save Changes' }).click();
		await expect(page.getByText('Profile updated', { exact: true })).toBeVisible();
		await expect(page.getByText('Not Confirmed')).toBeVisible();

		const prefs = await (await request.get('/api/users/me/notifications')).json();
		expect(prefs.email).toBe(email.toLowerCase());
		expect(prefs.notifyJobs).toBe(true);

		await request.patch('/api/users/me', { data: { notifyJobs: false, email: '' } });
		await disableMail(request);
	});
});
