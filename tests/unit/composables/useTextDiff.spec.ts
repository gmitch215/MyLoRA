import { describe, expect, it } from 'vitest';
import { diffRows, diffWords, splitSegments } from '~/composables/useTextDiff';

describe('useTextDiff - diffWords', () => {
	it('returns all eq ops for identical strings', () => {
		const ops = diffWords('the quick fox', 'the quick fox');
		expect(ops.every((o) => o.t === 'eq')).toBe(true);
		expect(ops.map((o) => o.v).join('')).toBe('the quick fox');
	});

	it('marks a replaced word as del + ins', () => {
		const ops = diffWords('the quick fox', 'the slow fox');
		expect(ops.some((o) => o.t === 'del' && o.v === 'quick')).toBe(true);
		expect(ops.some((o) => o.t === 'ins' && o.v === 'slow')).toBe(true);
	});

	it('handles pure insertion (empty left)', () => {
		// ''.split(/(\s+)/) is [''] which has no match, so the words are inserts
		const ops = diffWords('', 'hello world');
		expect(ops.some((o) => o.t === 'ins' && o.v === 'hello')).toBe(true);
		expect(ops.some((o) => o.t === 'ins' && o.v === 'world')).toBe(true);
	});

	it('handles pure deletion (empty right)', () => {
		const ops = diffWords('hello world', '');
		expect(ops.some((o) => o.t === 'del' && o.v === 'hello')).toBe(true);
		expect(ops.some((o) => o.t === 'del' && o.v === 'world')).toBe(true);
	});

	it('treats null/undefined input as empty (single empty eq token)', () => {
		expect(diffWords(undefined as any, undefined as any)).toEqual([{ t: 'eq', v: '' }]);
	});

	it('preserves whitespace tokens', () => {
		const ops = diffWords('a b', 'a b');
		// split(/(\s+)/) yields ['a',' ','b']
		expect(ops.map((o) => o.v)).toContain(' ');
	});
});

describe('useTextDiff - splitSegments', () => {
	it('splits on newlines and sentence terminators', () => {
		const segs = splitSegments('Hello world. How are you?\nSecond line!');
		expect(segs).toEqual(['Hello world.', 'How are you?', 'Second line!']);
	});

	it('trims and drops empty segments', () => {
		const segs = splitSegments('  a.  \n\n  b.  ');
		expect(segs).toEqual(['a.', 'b.']);
	});

	it('returns empty array for empty/nullish text', () => {
		expect(splitSegments('')).toEqual([]);
		expect(splitSegments(undefined as any)).toEqual([]);
	});

	it('keeps a single unterminated segment', () => {
		expect(splitSegments('just one line')).toEqual(['just one line']);
	});
});

describe('useTextDiff - diffRows', () => {
	it('emits eq rows for matching segments (case/space insensitive)', () => {
		// lcs uses the left value for both sides on an eq match
		const rows = diffRows('Hello world.', 'hello   world.');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ type: 'eq', left: 'Hello world.', right: 'Hello world.' });
	});

	it('pairs a changed segment as one change row', () => {
		const rows = diffRows('Old line.', 'New line.');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.type).toBe('change');
		expect(rows[0]!.left).toBe('Old line.');
		expect(rows[0]!.right).toBe('New line.');
	});

	it('fills the shorter side with null when counts differ', () => {
		const rows = diffRows('A. B.', 'X. Y. Z.');
		const changes = rows.filter((r) => r.type === 'change');
		// three inserts vs two dels -> at least one row with left null
		expect(changes.some((r) => r.left === null)).toBe(true);
	});

	it('handles a pure deletion block (right null)', () => {
		const rows = diffRows('A. B. C.', 'A.');
		expect(rows.some((r) => r.type === 'change' && r.right === null)).toBe(true);
	});

	it('returns empty for two empty inputs', () => {
		expect(diffRows('', '')).toEqual([]);
	});
});
