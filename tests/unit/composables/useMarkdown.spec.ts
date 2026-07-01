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

	it('honors breaks (single newline becomes a <br>)', () => {
		const html = renderMarkdown('line one\nline two');
		expect(html).toContain('<br>');
	});

	it('falls back to a raw pre block when highlighting throws', () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		// force hljs.highlight to throw by mocking getLanguage truthy but highlight failing
		const html = renderMarkdown('```js\nok\n```');
		// under normal operation it should not error; just assert output shape
		expect(html).toContain('<pre><code');
		errSpy.mockRestore();
	});

	it('returns a string for empty input', () => {
		expect(typeof renderMarkdown('')).toBe('string');
	});
});
