import { marked } from 'marked';

export type FeedInput = {
	siteUrl: string;
	name: string;
	description: string;
	author: string;
	supportEmail?: string;
	adapters: Adapter[];
};

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

// never throw on a bad/missing timestamp; epoch 0 sorts last and still serializes
function normalizeDate(value: Date | string | number | null | undefined): Date {
	const date = value === null || value === undefined ? new Date(NaN) : new Date(value);
	return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function feedByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

// crude markdown strip for the plain-text <summary>
function plainSummary(description: string | null | undefined, baseModel: string): string {
	const text = (description || '')
		.replace(/[#_*>`\-\n]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return `LoRA adapter for ${baseModel}`;
	return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

function renderDescription(description: string | null | undefined): string {
	if (!description?.trim()) return '';
	try {
		const html = marked(description, { breaks: true, gfm: true, async: false });
		return typeof html === 'string' ? html : '';
	} catch (e) {
		console.warn('feed markdown render failed', e);
		return '';
	}
}

// the registry facts a subscriber cares about, appended under the rendered description
function metaTable(adapter: Adapter): string {
	const rows: [string, string][] = [
		['Base Model', adapter.baseModel],
		['Model Type', adapter.modelType],
		['Rank', String(adapter.rank)],
		['Downloads', String(adapter.downloadCount)]
	];
	if (adapter.author?.displayName) rows.push(['Author', adapter.author.displayName]);
	const items = rows.map(([k, v]) => `<dt>${escapeXml(k)}</dt><dd>${escapeXml(v)}</dd>`).join('');
	return `<dl>${items}</dl>`;
}

function entryXml(adapter: Adapter, siteUrl: string): string {
	const createdAt = normalizeDate(adapter.created_at);
	const updatedAt = normalizeDate(adapter.updated_at ?? adapter.created_at);
	const entryUrl = `${siteUrl}/adapters/${adapter.slug}`;
	const categories = (adapter.tags || [])
		.map((tag) => `    <category term="${escapeXml(tag)}" />`)
		.join('\n');
	const content = `${renderDescription(adapter.description)}${metaTable(adapter)}`;

	return [
		'  <entry>',
		`    <title>${escapeXml(adapter.name || adapter.slug)}</title>`,
		`    <link href="${escapeXml(entryUrl)}" />`,
		`    <id>${escapeXml(entryUrl)}</id>`,
		`    <updated>${updatedAt.toISOString()}</updated>`,
		`    <published>${createdAt.toISOString()}</published>`,
		adapter.author?.displayName
			? `    <author><name>${escapeXml(adapter.author.displayName)}</name></author>`
			: '',
		categories,
		`    <summary type="text">${escapeXml(plainSummary(adapter.description, adapter.baseModel))}</summary>`,
		`    <content type="html">${escapeXml(content)}</content>`,
		'  </entry>'
	]
		.filter(Boolean)
		.join('\n');
}

/**
 * Render published adapters as an Atom 1.0 document.
 *
 * Pure: callers resolve the site url, branding, and the (already visibility-filtered) adapter
 * rows. Every interpolated value is xml-escaped, and `<content>` carries escaped html.
 */
export function buildAtomFeed(input: FeedInput): string {
	const siteUrl = (input.siteUrl || '').replace(/\/+$/, '');
	const adapters = input.adapters ?? [];

	const tags = new Set<string>();
	let mostRecent = new Date(0);
	for (const adapter of adapters) {
		for (const tag of adapter.tags || []) tags.add(tag);
		const updatedAt = normalizeDate(adapter.updated_at ?? adapter.created_at);
		if (updatedAt.getTime() > mostRecent.getTime()) mostRecent = updatedAt;
	}

	const feedCategories = Array.from(tags)
		.map((tag) => `  <category term="${escapeXml(tag)}" />`)
		.join('\n');

	return [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<feed xmlns="http://www.w3.org/2005/Atom">',
		`  <title>${escapeXml(input.name || 'MyLoRA')}</title>`,
		`  <subtitle>${escapeXml(input.description || 'A self-hostable LoRA adapter registry')}</subtitle>`,
		`  <link href="${escapeXml(`${siteUrl}/feed.xml`)}" rel="self" />`,
		`  <link href="${escapeXml(siteUrl)}" rel="alternate" />`,
		`  <updated>${mostRecent.toISOString()}</updated>`,
		`  <id>${escapeXml(siteUrl)}/</id>`,
		'  <generator>MyLoRA</generator>',
		feedCategories,
		'  <author>',
		`    <name>${escapeXml(input.author || input.name || 'MyLoRA')}</name>`,
		input.supportEmail ? `    <email>${escapeXml(input.supportEmail)}</email>` : '',
		'  </author>',
		...adapters.map((adapter) => entryXml(adapter, siteUrl)),
		'</feed>'
	]
		.filter(Boolean)
		.join('\n');
}
