import { createAdapter, deleteAdapter, uploadAssets } from '../utils/adapters';
import { expect, test } from './fixtures';

// the route is cached for 300s and busted by invalidateAdapterLists on every adapter write, so a
// fetch after a create/delete must already reflect it
async function feed(request: import('@playwright/test').APIRequestContext) {
	const res = await request.get('/feed.xml');
	expect(res.status()).toBe(200);
	return { res, xml: await res.text() };
}

test.describe('atom feed', () => {
	test('serves a well-formed atom document with the right headers', async ({ request }) => {
		const { res, xml } = await feed(request);
		expect(res.headers()['content-type']).toContain('application/atom+xml');
		expect(res.headers()['cache-control']).toContain('max-age=300');
		expect(Number(res.headers()['content-length'])).toBe(Buffer.byteLength(xml, 'utf8'));

		expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		expect(xml.trimEnd().endsWith('</feed>')).toBe(true);
		expect(xml).toContain('rel="self"');
		expect(xml).toContain('<generator>MyLoRA</generator>');
	});

	test('lists a listed public adapter and drops it again on delete', async ({ request }) => {
		const slug = `feed-listed-${Date.now()}`;
		const { id } = await createAdapter(request, { slug, name: 'Feed Listed' });
		// draft: not yet in the feed
		expect((await feed(request)).xml).not.toContain(slug);

		// uploading both assets flips it to 'listed', which the feed includes
		await uploadAssets(request, id);
		const { xml } = await feed(request);
		expect(xml).toContain(`/adapters/${slug}`);
		expect(xml).toContain('<title>Feed Listed</title>');
		expect(xml).toContain('<content type="html">');

		await deleteAdapter(request, id);
		expect((await feed(request)).xml).not.toContain(slug);
	});

	test('excludes private and unlisted adapters', async ({ request }) => {
		const priv = `feed-private-${Date.now()}`;
		const unl = `feed-unlisted-${Date.now()}`;
		const a = await createAdapter(request, { slug: priv, visibility: 'private' });
		const b = await createAdapter(request, { slug: unl, visibility: 'unlisted' });
		await uploadAssets(request, a.id);
		await uploadAssets(request, b.id);

		const { xml } = await feed(request);
		expect(xml).not.toContain(priv);
		expect(xml).not.toContain(unl);

		await deleteAdapter(request, a.id);
		await deleteAdapter(request, b.id);
	});

	test('escapes xml metacharacters in adapter names and tags', async ({ request }) => {
		const slug = `feed-escape-${Date.now()}`;
		const { id } = await createAdapter(request, {
			slug,
			name: 'Feed & <Escape> "Test"',
			tags: ["it's", 'a&b']
		});
		await uploadAssets(request, id);

		const { xml } = await feed(request);
		expect(xml).toContain('Feed &amp; &lt;Escape&gt; &quot;Test&quot;');
		expect(xml).not.toContain('Feed & <Escape>');
		expect(xml).toContain('<category term="it&apos;s" />');
		expect(xml).toContain('<category term="a&amp;b" />');

		await deleteAdapter(request, id);
	});

	test('advertises the feed for autodiscovery on the home page', async ({ request }) => {
		const html = await (await request.get('/')).text();
		expect(html).toMatch(
			/<link[^>]+rel="alternate"[^>]+type="application\/atom\+xml"|<link[^>]+type="application\/atom\+xml"[^>]+rel="alternate"/
		);
		expect(html).toContain('/feed.xml');
	});
});
