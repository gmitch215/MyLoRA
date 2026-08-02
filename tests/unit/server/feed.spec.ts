import { describe, expect, it } from 'vitest';
import { buildAtomFeed, feedByteLength } from '../../../src/server/utils/feed';

function adapter(over: Record<string, unknown> = {}): any {
	return {
		id: 'a1',
		name: 'My Adapter',
		slug: 'my-adapter',
		description: 'A **bold** adapter.',
		baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
		modelType: 'mistral',
		rank: 8,
		configBytes: 10,
		weightsBytes: 20,
		tags: ['chat', 'tone'],
		examples: [],
		screenshots: [],
		visibility: 'public',
		cfPublic: false,
		status: 'published',
		downloadCount: 42,
		inferenceCount: 7,
		author: { id: 'u1', username: 'alice', displayName: 'Alice', role: 'developer' },
		created_at: new Date('2026-01-02T03:04:05.000Z'),
		updated_at: new Date('2026-02-03T04:05:06.000Z'),
		...over
	};
}

const base = {
	siteUrl: 'https://lora.example.com',
	name: 'MyLoRA',
	description: 'A registry',
	author: 'Greg'
};

describe('buildAtomFeed', () => {
	it('renders a well-formed atom document with one entry per adapter', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter()] });
		expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
		expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		expect(xml.trimEnd().endsWith('</feed>')).toBe(true);
		expect(xml).toContain('<title>MyLoRA</title>');
		expect(xml).toContain('<subtitle>A registry</subtitle>');
		expect(xml).toContain('<link href="https://lora.example.com/feed.xml" rel="self" />');
		expect(xml).toContain('<link href="https://lora.example.com" rel="alternate" />');
		expect(xml).toContain('<generator>MyLoRA</generator>');
		expect(xml).toContain('<name>Greg</name>');
		expect((xml.match(/<entry>/g) ?? []).length).toBe(1);
	});

	it('links each entry at /adapters/<slug> and dates it from created/updated', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter()] });
		expect(xml).toContain('<link href="https://lora.example.com/adapters/my-adapter" />');
		expect(xml).toContain('<id>https://lora.example.com/adapters/my-adapter</id>');
		expect(xml).toContain('<published>2026-01-02T03:04:05.000Z</published>');
		expect(xml).toContain('<updated>2026-02-03T04:05:06.000Z</updated>');
	});

	it('strips a trailing slash from the site url', () => {
		const xml = buildAtomFeed({ ...base, siteUrl: 'https://lora.example.com///', adapters: [] });
		expect(xml).toContain('<link href="https://lora.example.com/feed.xml" rel="self" />');
		expect(xml).not.toContain('example.com//');
	});

	it('escapes xml metacharacters everywhere they can appear', () => {
		const xml = buildAtomFeed({
			...base,
			name: 'A & B',
			adapters: [
				adapter({
					name: 'Tom & "Jerry" <script>',
					slug: 'a&b',
					tags: ["it's", 'x<y'],
					author: { displayName: 'A & A' }
				})
			]
		});
		expect(xml).toContain('<title>A &amp; B</title>');
		expect(xml).toContain('<title>Tom &amp; &quot;Jerry&quot; &lt;script&gt;</title>');
		expect(xml).toContain('<category term="it&apos;s" />');
		expect(xml).toContain('<category term="x&lt;y" />');
		expect(xml).toContain('<name>A &amp; A</name>');
		// no raw metacharacter survives outside the xml structure itself
		expect(xml).not.toContain('Tom & "Jerry"');
		expect(xml).not.toContain('<script>');
	});

	it('escapes the rendered html into <content type="html">', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter()] });
		expect(xml).toContain('<content type="html">');
		expect(xml).toContain('&lt;strong&gt;bold&lt;/strong&gt;');
		expect(xml).not.toContain('<strong>bold</strong>');
	});

	it('appends the registry metadata table to the content', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter()] });
		expect(xml).toContain('&lt;dt&gt;Base Model&lt;/dt&gt;');
		expect(xml).toContain('@cf/mistral/mistral-7b-instruct-v0.2-lora');
		expect(xml).toContain('&lt;dt&gt;Downloads&lt;/dt&gt;&lt;dd&gt;42&lt;/dd&gt;');
		expect(xml).toContain('&lt;dt&gt;Rank&lt;/dt&gt;&lt;dd&gt;8&lt;/dd&gt;');
	});

	it('falls back to a generated summary when there is no description', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter({ description: null })] });
		expect(xml).toContain(
			'<summary type="text">LoRA adapter for @cf/mistral/mistral-7b-instruct-v0.2-lora</summary>'
		);
		expect(xml).toContain('<content type="html">');
	});

	it('truncates a long summary to 200 characters plus an ellipsis', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter({ description: 'z'.repeat(500) })] });
		const summary = /<summary type="text">([\s\S]*?)<\/summary>/.exec(xml)?.[1] ?? '';
		expect(summary).toHaveLength(203);
		expect(summary.endsWith('...')).toBe(true);
	});

	it('unions every tag into feed-level categories', () => {
		const xml = buildAtomFeed({
			...base,
			adapters: [adapter({ tags: ['a', 'b'] }), adapter({ id: 'a2', slug: 's2', tags: ['b', 'c'] })]
		});
		expect((xml.match(/^ {2}<category term="b" \/>$/gm) ?? []).length).toBe(1);
		expect(xml).toContain('  <category term="a" />');
		expect(xml).toContain('  <category term="c" />');
	});

	it('uses the newest entry timestamp as the feed <updated>', () => {
		const xml = buildAtomFeed({
			...base,
			adapters: [
				adapter({ updated_at: new Date('2026-05-01T00:00:00.000Z') }),
				adapter({ id: 'a2', slug: 's2', updated_at: new Date('2026-09-09T00:00:00.000Z') })
			]
		});
		expect(xml).toContain('  <updated>2026-09-09T00:00:00.000Z</updated>');
	});

	it('never throws on a missing or invalid timestamp', () => {
		const xml = buildAtomFeed({
			...base,
			adapters: [adapter({ created_at: 'not-a-date', updated_at: undefined })]
		});
		expect(xml).toContain('<published>1970-01-01T00:00:00.000Z</published>');
		expect(xml).toContain('<updated>1970-01-01T00:00:00.000Z</updated>');
	});

	it('falls back to updated_at from created_at when updated_at is absent', () => {
		const xml = buildAtomFeed({
			...base,
			adapters: [adapter({ updated_at: null, created_at: new Date('2026-07-07T00:00:00.000Z') })]
		});
		expect(xml).toContain('<updated>2026-07-07T00:00:00.000Z</updated>');
	});

	it('omits the author element when the adapter has none', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter({ author: null })] });
		const entry = /<entry>[\s\S]*<\/entry>/.exec(xml)?.[0] ?? '';
		expect(entry).not.toContain('<author>');
	});

	it('titles an unnamed adapter with its slug', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter({ name: '' })] });
		expect(xml).toContain('<title>my-adapter</title>');
	});

	it('emits a valid empty feed with no entries', () => {
		const xml = buildAtomFeed({ ...base, adapters: [] });
		expect(xml).not.toContain('<entry>');
		expect(xml).toContain('<updated>1970-01-01T00:00:00.000Z</updated>');
		expect(xml.trimEnd().endsWith('</feed>')).toBe(true);
	});

	it('tolerates a null adapters list and blank branding', () => {
		const xml = buildAtomFeed({
			siteUrl: '',
			name: '',
			description: '',
			author: '',
			adapters: null as never
		});
		expect(xml).toContain('<title>MyLoRA</title>');
		expect(xml).toContain('<subtitle>A self-hostable LoRA adapter registry</subtitle>');
	});

	it('includes the support email only when one is set', () => {
		expect(buildAtomFeed({ ...base, adapters: [] })).not.toContain('<email>');
		expect(buildAtomFeed({ ...base, supportEmail: 'hi@example.com', adapters: [] })).toContain(
			'<email>hi@example.com</email>'
		);
	});
});

describe('feedByteLength', () => {
	it('counts utf-8 bytes, not code units', () => {
		expect(feedByteLength('abc')).toBe(3);
		// a 4-byte emoji is 2 js code units but 4 bytes on the wire
		expect('\u{1F600}'.length).toBe(2);
		expect(feedByteLength('\u{1F600}')).toBe(4);
	});

	it('matches the byte length of a rendered feed', () => {
		const xml = buildAtomFeed({ ...base, adapters: [adapter()] });
		expect(feedByteLength(xml)).toBe(Buffer.byteLength(xml, 'utf8'));
	});
});
