import { describe, expect, it } from 'vitest';
import { toAdapter, toPublicUser } from '../../../src/server/utils/serialize';

// db rows are cast loosely; the serializers only read the fields they map
const userRow = {
	id: 'u1',
	username: 'alice',
	displayName: 'Alice',
	role: 'developer',
	avatarPathname: 'avatars/a.png',
	bio: 'hi',
	// extra secret-ish fields that must never leak
	passwordHash: 'secret'
} as any;

function adapterRow(over: Record<string, unknown> = {}) {
	return {
		id: 'a1',
		name: 'My Adapter',
		slug: 'my-adapter',
		description: 'desc',
		baseModel: '@cf/meta/llama',
		modelType: 'llama',
		rank: 8,
		configBytes: 10,
		weightsBytes: 20,
		promptTemplate: '{{prompt}}',
		tags: 'a, b ,, c',
		examples: '[{"input":"x","output":"y"}]',
		screenshots: '["s1","s2"]',
		iconName: 'i-lucide-box',
		iconColor: '#fff',
		visibility: 'public',
		cfPublic: true,
		accountId: 'acc1',
		finetuneId: 'ft1',
		finetuneName: 'ft-name',
		authorId: 'u1',
		status: 'ready',
		statusMessage: null,
		downloadCount: 3,
		inferenceCount: 4,
		createdAt: '2026-01-02T03:04:05.000Z',
		updatedAt: '2026-01-03T03:04:05.000Z',
		...over
	} as any;
}

describe('toPublicUser', () => {
	it('returns null for null/undefined/no-id', () => {
		expect(toPublicUser(null)).toBeNull();
		expect(toPublicUser(undefined)).toBeNull();
		expect(toPublicUser({ username: 'x' } as any)).toBeNull();
	});

	it('maps only the public fields and drops secrets', () => {
		const u = toPublicUser(userRow)!;
		expect(u).toEqual({
			id: 'u1',
			username: 'alice',
			displayName: 'Alice',
			role: 'developer',
			avatarPathname: 'avatars/a.png',
			bio: 'hi'
		});
		expect((u as any).passwordHash).toBeUndefined();
	});

	it('coerces missing avatar/bio to null', () => {
		const u = toPublicUser({ id: 'u2', username: 'b', displayName: 'B', role: 'manager' } as any)!;
		expect(u.avatarPathname).toBeNull();
		expect(u.bio).toBeNull();
	});
});

describe('toAdapter', () => {
	it('parses tags (trim + drop empties)', () => {
		const a = toAdapter(adapterRow());
		expect(a.tags).toEqual(['a', 'b', 'c']);
	});

	it('parses examples and screenshots json arrays', () => {
		const a = toAdapter(adapterRow());
		expect(a.examples).toEqual([{ input: 'x', output: 'y' }]);
		expect(a.screenshots).toEqual(['s1', 's2']);
	});

	it('empties on null/blank/invalid json', () => {
		const a = toAdapter(adapterRow({ tags: null, examples: null, screenshots: 'not json' }));
		expect(a.tags).toEqual([]);
		expect(a.examples).toEqual([]);
		expect(a.screenshots).toEqual([]);
	});

	it('empties when json parses to a non-array', () => {
		const a = toAdapter(adapterRow({ examples: '{"input":"x"}', screenshots: '42' }));
		expect(a.examples).toEqual([]);
		expect(a.screenshots).toEqual([]);
	});

	it('converts timestamps to Date', () => {
		const a = toAdapter(adapterRow());
		expect(a.created_at).toBeInstanceOf(Date);
		expect(a.updated_at).toBeInstanceOf(Date);
		expect(a.created_at.toISOString()).toBe('2026-01-02T03:04:05.000Z');
	});

	it('author is null without an author arg, public shape when passed', () => {
		expect(toAdapter(adapterRow()).author).toBeNull();
		const withAuthor = toAdapter(adapterRow(), userRow);
		expect(withAuthor.author?.id).toBe('u1');
		expect((withAuthor.author as any)?.passwordHash).toBeUndefined();
	});
});
