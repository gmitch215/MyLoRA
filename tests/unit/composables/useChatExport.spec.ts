import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatsToText, chatToText, useChatExport } from '~/composables/useChatExport';

const msg = (role: 'user' | 'assistant' | 'system', content: string) => ({ role, content }) as any;

describe('useChatExport - chatToText', () => {
	it('renders role labels and trims content', () => {
		const out = chatToText([msg('user', '  hi  '), msg('assistant', 'hello')]);
		expect(out).toContain('## You');
		expect(out).toContain('## Assistant');
		expect(out).toContain('hi');
		expect(out.endsWith('\n')).toBe(true);
	});

	it('labels the system role as System', () => {
		const out = chatToText([msg('system', 'be nice')]);
		expect(out).toContain('## System');
	});

	it('prepends a title heading when provided', () => {
		const out = chatToText([msg('user', 'yo')], { title: 'Session A' });
		expect(out.startsWith('# Session A')).toBe(true);
	});

	it('skips empty/whitespace-only messages', () => {
		const out = chatToText([msg('user', '   '), msg('assistant', 'kept')]);
		expect(out).not.toContain('## You');
		expect(out).toContain('kept');
	});

	it('handles missing content field gracefully', () => {
		const out = chatToText([{ role: 'user' } as any]);
		expect(out).toBe('\n');
	});
});

describe('useChatExport - chatsToText', () => {
	it('joins sections that have content with a separator', () => {
		// each section title becomes an h1 inside chatToText
		const out = chatsToText([
			{ title: 'A', messages: [msg('user', 'one')] },
			{ title: 'B', messages: [msg('user', 'two')] }
		]);
		expect(out).toContain('# A');
		expect(out).toContain('# B');
		expect(out).toContain('---');
	});

	it('drops sections whose messages are all empty', () => {
		const out = chatsToText([
			{ title: 'Empty', messages: [msg('user', '   ')] },
			{ title: 'Full', messages: [msg('user', 'hi')] }
		]);
		expect(out).not.toContain('## Empty');
		expect(out).toContain('# Full');
	});

	it('adds a top-level title header when given', () => {
		const out = chatsToText([{ title: 'A', messages: [msg('user', 'x')] }], { title: 'Compare' });
		expect(out.startsWith('# Compare')).toBe(true);
	});

	it('ends with a trailing newline and omits the doc-level title header', () => {
		const out = chatsToText([{ messages: [msg('user', 'x')] }]);
		expect(out.endsWith('\n')).toBe(true);
		// no doc title, and the section had no title either, so no h1
		expect(out.startsWith('# ')).toBe(false);
		expect(out).toContain('## You');
	});
});

describe('useChatExport - composable', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('copy writes to clipboard and toggles copied with a timeout', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { copied, copy } = useChatExport();
		expect(copied.value).toBe(false);
		await copy('some text');
		expect(writeText).toHaveBeenCalledWith('some text');
		expect(copied.value).toBe(true);
		vi.advanceTimersByTime(1500);
		expect(copied.value).toBe(false);
		vi.unstubAllGlobals();
	});

	it('copy is a no-op for blank text', async () => {
		const writeText = vi.fn();
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { copied, copy } = useChatExport();
		await copy('   ');
		expect(writeText).not.toHaveBeenCalled();
		expect(copied.value).toBe(false);
		vi.unstubAllGlobals();
	});

	it('download creates an anchor, appends .md, and clicks it', () => {
		const createObjectURL = vi.fn().mockReturnValue('blob:x');
		const revokeObjectURL = vi.fn();
		vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
		const click = vi.fn();
		const a: any = { click, remove: vi.fn(), href: '', download: '' };
		const createElement = vi.spyOn(document, 'createElement').mockReturnValue(a);
		const appendChild = vi.spyOn(document.body, 'appendChild').mockReturnValue(a);

		const { download } = useChatExport();
		download('body', 'transcript');
		expect(createElement).toHaveBeenCalledWith('a');
		expect(a.download).toBe('transcript.md');
		expect(click).toHaveBeenCalled();
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');

		appendChild.mockRestore();
		createElement.mockRestore();
		vi.unstubAllGlobals();
	});

	it('download keeps an existing .md extension', () => {
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn().mockReturnValue('blob:y'),
			revokeObjectURL: vi.fn()
		});
		const a: any = { click: vi.fn(), remove: vi.fn(), href: '', download: '' };
		vi.spyOn(document, 'createElement').mockReturnValue(a);
		vi.spyOn(document.body, 'appendChild').mockReturnValue(a);
		const { download } = useChatExport();
		download('body', 'already.md');
		expect(a.download).toBe('already.md');
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('download is a no-op for blank text', () => {
		const createElement = vi.spyOn(document, 'createElement');
		const { download } = useChatExport();
		download('   ', 'x');
		expect(createElement).not.toHaveBeenCalled();
		createElement.mockRestore();
	});
});
