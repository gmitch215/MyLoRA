import { createAdapter, publishAdapter, uploadAssets } from '../utils/adapters';
import { loginViaApi } from '../utils/auth';
import {
	clearSink,
	confirmedSubscriber,
	disableMail,
	drain,
	enableMail,
	linkIn,
	readSink,
	removeTestSubscribers,
	setConfirmedEmail,
	subscribe,
	uniqueEmail,
	uniqueIp
} from '../utils/mail';
import { expect, test } from './fixtures';

// the sink (MYLORA_MAIL_SINK=1) records every message instead of sending it, so these specs read
// what a real recipient would get. publishes elsewhere in the suite also queue mail for any active
// subscriber, so each assertion filters by the adapter name or recipient it cares about.
test.describe.configure({ mode: 'serial' });

async function waitPublished(request: Parameters<typeof loginViaApi>[0], id: string) {
	await expect
		.poll(async () => (await (await request.get(`/api/adapters/${id}/status`)).json()).status, {
			timeout: 10_000
		})
		.toBe('published');
}

async function publishedAdapter(
	request: Parameters<typeof loginViaApi>[0],
	visibility: 'public' | 'private' = 'public'
) {
	const adapter = await createAdapter(request, { visibility });
	await uploadAssets(request, adapter.id);
	await publishAdapter(request, adapter.id);
	await waitPublished(request, adapter.id);
	return adapter;
}

test.describe('mail api', () => {
	test.afterEach(async ({ request }) => {
		await removeTestSubscribers(request);
		await disableMail(request);
	});

	test('subscriptions are off until an admin enables mail', async ({ request }) => {
		await disableMail(request);
		const status = await (await request.get('/api/subscribers/status')).json();
		expect(status.enabled).toBe(false);
		const res = await subscribe(request, uniqueEmail());
		expect(res.status()).toBe(404);
	});

	test('mail settings are admin only and never echo secrets', async ({ playwright, request }) => {
		const anon = await playwright.request.newContext({
			baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787'
		});
		expect([401, 403]).toContain((await anon.get('/api/admin/mail')).status());
		await anon.dispose();

		await enableMail(request);
		const settings = await (await request.get('/api/admin/mail')).json();
		expect(settings.status.configured).toBe(true);
		expect(settings.hasSmtpPassword).toBe(true);
		expect(JSON.stringify(settings)).not.toContain('hunter2');
	});

	test('subscribe sends a confirmation, confirming activates, repeats are quiet', async ({
		request
	}) => {
		await enableMail(request);
		const email = uniqueEmail();
		const res = await subscribe(request, email);
		expect(res.ok()).toBe(true);

		const mail = (await readSink(request)).find((m) => m.to === email)!;
		expect(mail.subject).toMatch(/confirm your subscription/i);
		const link = linkIn(mail, '/subscribe/confirm');
		const body = { id: link.searchParams.get('id')!, token: link.searchParams.get('token')! };

		// the token is bound to its purpose: a confirm token cannot unsubscribe
		const wrong = await request.post('/api/subscribers/unsubscribe', { data: body });
		expect(wrong.status()).toBe(400);
		const bad = await request.post('/api/subscribers/confirm', {
			data: { id: body.id, token: `${body.token}x` }
		});
		expect(bad.status()).toBe(400);

		expect((await request.post('/api/subscribers/confirm', { data: body })).ok()).toBe(true);
		// confirming twice is fine
		expect((await request.post('/api/subscribers/confirm', { data: body })).ok()).toBe(true);

		await clearSink(request);
		expect((await subscribe(request, email)).ok()).toBe(true);
		expect((await readSink(request)).filter((m) => m.to === email)).toHaveLength(0);
	});

	test('a filled honeypot succeeds silently and sends nothing', async ({ request }) => {
		await enableMail(request);
		const email = uniqueEmail();
		const res = await request.post('/api/subscribers/subscribe', {
			data: { email, website: 'https://spam.invalid' },
			headers: { 'x-forwarded-for': uniqueIp() }
		});
		expect(res.ok()).toBe(true);
		expect((await readSink(request)).filter((m) => m.to === email)).toHaveLength(0);
	});

	test('one subscribe per client per minute', async ({ request }) => {
		await enableMail(request);
		const ip = uniqueIp();
		expect((await subscribe(request, uniqueEmail(), ip)).ok()).toBe(true);
		expect((await subscribe(request, uniqueEmail(), ip)).status()).toBe(429);
	});

	test('a published public adapter emails active subscribers once, with one-click unsubscribe', async ({
		request
	}) => {
		await enableMail(request);
		const sub = await confirmedSubscriber(request);

		const adapter = await publishedAdapter(request);
		await expect
			.poll(async () => (await (await request.get('/api/admin/mail')).json()).outbox.pending)
			.toBeGreaterThan(0);
		await drain(request);

		const mails = (await readSink(request)).filter((m) => m.to === sub.email);
		const mail = mails.find((m) => m.text.includes(`/adapters/${adapter.slug}`))!;
		expect(mail.subject).toMatch(/^New adapter:/);
		expect(mail.headers?.['List-Unsubscribe']).toContain('/api/subscribers/unsubscribe');
		expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

		// a second drain sends nothing more for this adapter
		await drain(request);
		const again = (await readSink(request)).filter(
			(m) => m.to === sub.email && m.text.includes(`/adapters/${adapter.slug}`)
		);
		expect(again).toHaveLength(1);

		// one-click unsubscribe works from the header url and removes the subscriber
		const oneClick = mail.headers!['List-Unsubscribe']!.replace(/^<|>$/g, '');
		const url = new URL(oneClick);
		const res = await request.post(`${url.pathname}${url.search}`);
		expect(res.ok()).toBe(true);
		await loginViaApi(request);
		const rows = (await (await request.get('/api/admin/subscribers')).json()).rows as {
			email: string;
		}[];
		expect(rows.find((r) => r.email === sub.email)).toBeUndefined();
	});

	test('listed adapters are emailed only after an admin picks listed', async ({ request }) => {
		await enableMail(request);
		const sub = await confirmedSubscriber(request);

		// default: a listed (uploaded, not yet published) adapter stays quiet
		const quiet = await createAdapter(request);
		await uploadAssets(request, quiet.id);
		await drain(request);
		expect(
			(await readSink(request)).filter(
				(m) => m.to === sub.email && m.text.includes(`/adapters/${quiet.slug}`)
			)
		).toHaveLength(0);

		const set = await request.post('/api/admin/mail', { data: { notifyOn: 'listed' } });
		expect(set.ok()).toBe(true);
		expect((await set.json()).notifyOn).toBe('listed');

		const loud = await createAdapter(request);
		await uploadAssets(request, loud.id);
		await expect
			.poll(async () => (await (await request.get('/api/admin/mail')).json()).outbox.pending)
			.toBeGreaterThan(0);
		await drain(request);
		const mails = (await readSink(request)).filter(
			(m) => m.to === sub.email && m.text.includes(`/adapters/${loud.slug}`)
		);
		expect(mails).toHaveLength(1);

		// publishing the same adapter later does not send a second email
		await publishAdapter(request, loud.id);
		await waitPublished(request, loud.id);
		await drain(request);
		expect(
			(await readSink(request)).filter(
				(m) => m.to === sub.email && m.text.includes(`/adapters/${loud.slug}`)
			)
		).toHaveLength(1);
	});

	test('a private adapter is never emailed', async ({ request }) => {
		await enableMail(request);
		const sub = await confirmedSubscriber(request);
		const adapter = await publishedAdapter(request, 'private');
		await drain(request);
		const hits = (await readSink(request)).filter(
			(m) => m.to === sub.email && m.text.includes(`/adapters/${adapter.slug}`)
		);
		expect(hits).toHaveLength(0);
	});

	test('the admin list, search and csv export see subscribers', async ({ request }) => {
		await enableMail(request);
		const sub = await confirmedSubscriber(request);
		const list = await (
			await request.get('/api/admin/subscribers', { params: { search: sub.email } })
		).json();
		expect(list.total).toBe(1);
		expect(list.rows[0].status).toBe('active');

		const csv = await (await request.get('/api/admin/subscribers/export')).text();
		expect(csv.split('\n')[0]).toBe('email,status,subscribed_at,confirmed_at');
		expect(csv).toContain(sub.email);
	});
});

test.describe('job email preferences', () => {
	test.afterEach(async ({ request }) => {
		await loginViaApi(request);
		await request.patch('/api/users/me', { data: { notifyJobs: false, email: '' } });
		await disableMail(request);
	});

	test('rejects a bad address and job emails without one', async ({ request }) => {
		await loginViaApi(request);
		const bad = await request.patch('/api/users/me', { data: { email: 'not-an-email' } });
		expect(bad.status()).toBe(400);
		const none = await request.patch('/api/users/me', { data: { notifyJobs: true } });
		expect(none.status()).toBe(400);
	});

	test('stores the address unconfirmed and reports whether mail is on', async ({ request }) => {
		await enableMail(request);
		const email = uniqueEmail('author');
		const res = await request.patch('/api/users/me', { data: { email, notifyJobs: true } });
		expect(res.ok()).toBe(true);
		const prefs = await (await request.get('/api/users/me/notifications')).json();
		expect(prefs).toEqual({
			email: email.toLowerCase(),
			emailConfirmed: false,
			notifyJobs: true,
			mailEnabled: true
		});
	});

	test('a new address mails a confirmation link that confirms it', async ({ request }) => {
		await enableMail(request);
		const email = uniqueEmail('confirm');
		await setConfirmedEmail(request, email);
		const prefs = await (await request.get('/api/users/me/notifications')).json();
		expect(prefs.emailConfirmed).toBe(true);
	});

	test('changing the address resets confirmation and voids the old link', async ({ request }) => {
		await enableMail(request);
		await loginViaApi(request);
		const first = uniqueEmail('first');
		await clearSink(request);
		await request.patch('/api/users/me', { data: { email: first } });
		const oldLink = linkIn(
			(await readSink(request)).find((m) => m.to === first.toLowerCase())!,
			'/confirm-email'
		);

		await setConfirmedEmail(request, uniqueEmail('second'));
		expect((await (await request.get('/api/users/me/notifications')).json()).emailConfirmed).toBe(
			true
		);

		// move to a third address: unconfirmed again, and the first address's link no longer works
		await request.patch('/api/users/me', { data: { email: uniqueEmail('third') } });
		expect((await (await request.get('/api/users/me/notifications')).json()).emailConfirmed).toBe(
			false
		);
		const stale = await request.post('/api/users/confirm-email', {
			data: {
				id: oldLink.searchParams.get('id')!,
				token: oldLink.searchParams.get('token')!
			}
		});
		expect(stale.status()).toBe(400);
	});

	test('a tampered or wrong-purpose token never confirms', async ({ request }) => {
		await enableMail(request);
		await loginViaApi(request);
		const email = uniqueEmail('tamper');
		await clearSink(request);
		await request.patch('/api/users/me', { data: { email } });
		const link = linkIn(
			(await readSink(request)).find((m) => m.to === email.toLowerCase())!,
			'/confirm-email'
		);
		const id = link.searchParams.get('id')!;
		const token = link.searchParams.get('token')!;
		expect(
			(
				await request.post('/api/users/confirm-email', { data: { id, token: `${token}x` } })
			).status()
		).toBe(400);
		// the same signature as a subscriber unsubscribe token must not work here
		expect(
			(await request.post('/api/subscribers/unsubscribe', { data: { id, token } })).status()
		).toBe(400);
	});

	test('resending is rate limited and needs an address', async ({ request }) => {
		await enableMail(request);
		await loginViaApi(request);
		await request.patch('/api/users/me', { data: { email: '' } });
		expect((await request.post('/api/users/me/email-confirmation')).status()).toBe(409);

		await request.patch('/api/users/me', { data: { email: uniqueEmail('resend') } });
		// the save already mailed one, so an immediate resend is inside the cooldown
		expect((await request.post('/api/users/me/email-confirmation')).status()).toBe(429);
	});

	test('the public user profile never exposes the address', async ({ request }) => {
		await loginViaApi(request);
		const email = uniqueEmail('private');
		await request.patch('/api/users/me', { data: { email } });
		const profile = await (await request.get('/api/users/admin')).text();
		expect(profile).not.toContain(email);
		expect((await (await request.get('/api/verify')).text()).includes(email)).toBe(false);
	});
});
