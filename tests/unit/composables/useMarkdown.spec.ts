import { describe, expect, it, vi } from 'vitest';
import { useMarkdown } from '~/composables/useMarkdown';

describe('useMarkdown', () => {
	const { renderMarkdown } = useMarkdown();

	it('renders headings', () => {
		expect(renderMarkdown('# Title')).toContain('<h1');
	});

	it('renders links (gfm)', () => {
		const html = renderMarkdown('[nuxt](https://nuxt.com)');
		expect(html).toContain('<a');
		expect(html).toContain('href="https://nuxt.com"');
	});

	it('highlights a fenced code block with a known language', () => {
		const html = renderMarkdown('```js\nconst x = 1;\n```');
		expect(html).toContain('language-js');
		expect(html).toContain('hljs');
		expect(html).toContain('<pre><code');
	});

	it('falls back to plaintext for an unknown language', () => {
		const html = renderMarkdown('```notalang\nhello\n```');
		expect(html).toContain('language-plaintext');
	});

	it('renders code with no language as plaintext', () => {
		const html = renderMarkdown('```\nplain text\n```');
		expect(html).toContain('language-plaintext');
	});

	it('supports the custom ++underline++ extension', () => {
		const html = renderMarkdown('this is ++underlined++ text');
		expect(html).toContain('<u>underlined</u>');
	});

	it('treats a single newline as a soft wrap, not a <br>', () => {
		// regression: breaks:true rendered hard-wrapped model output one word per line
		const html = renderMarkdown('line one\nline two');
		expect(html).not.toContain('<br>');
		expect(html).toContain('<p>line one\nline two</p>');
	});

	it('keeps hard-wrapped prose as one flowing paragraph', () => {
		const html = renderMarkdown('Military\ninterventions\nhave\noften\nfailed\nto achieve it.');
		expect(html).not.toContain('<br>');
		expect((html.match(/<p>/g) ?? []).length).toBe(1);
	});

	it('still splits paragraphs on a blank line', () => {
		const html = renderMarkdown('First para.\n\nSecond para.');
		expect((html.match(/<p>/g) ?? []).length).toBe(2);
	});

	it('still renders a list written without blank lines', () => {
		const html = renderMarkdown('- one\n- two\n- three');
		expect(html).toContain('<ul>');
		expect((html.match(/<li>/g) ?? []).length).toBe(3);
	});

	it('renders every heading level, bold and italic', () => {
		const html = renderMarkdown('# H1\n\n## H2\n\n### H3\n\nSome **bold** and *italic* text.');
		expect(html).toContain('<h1');
		expect(html).toContain('<h2');
		expect(html).toContain('<h3');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
	});

	it('renders inline code, blockquotes and gfm tables', () => {
		expect(renderMarkdown('use `npm i`')).toContain('<code>npm i</code>');
		expect(renderMarkdown('> quoted')).toContain('<blockquote>');
		const table = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
		expect(table).toContain('<table>');
		expect(table).toContain('<td>1</td>');
	});

	it('falls back to a raw pre block when highlighting throws', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const hljs = (await import('highlight.js/lib/common')).default;
		const spy = vi.spyOn(hljs, 'highlight').mockImplementation(() => {
			throw new Error('boom');
		});

		const html = renderMarkdown('```js\nconst x = 1;\n```');
		expect(html).toContain('<pre><code class="hljs">');
		// the raw source survives instead of the render dying
		expect(html).toContain('const x = 1;');
		expect(errSpy).toHaveBeenCalled();

		spy.mockRestore();
		errSpy.mockRestore();
	});

	it('returns a string for empty input', () => {
		expect(typeof renderMarkdown('')).toBe('string');
	});
});
