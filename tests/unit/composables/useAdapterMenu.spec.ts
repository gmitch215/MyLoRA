import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdapterMenu } from '~/composables/useAdapterMenu';

// hoisted so the mockNuxtImport factories (also hoisted) can reference them safely
const { authState, toastAdd, navigateToMock } = vi.hoisted(() => ({
	authState: { user: null as any, loggedIn: false, can: (() => false) as any },
	toastAdd: vi.fn(),
	navigateToMock: vi.fn()
}));

mockNuxtImport('useAuthStore', () => () => authState);
mockNuxtImport('useToast', () => () => ({ add: toastAdd }));
mockNuxtImport('navigateTo', () => navigateToMock);

const adapter = (over: Record<string, any> = {}) =>
	({
		id: 'a1',
		slug: 'my-lora',
		authorId: 'author-1',
		status: 'published',
		configBytes: 10,
		weightsBytes: 20,
		...over
	}) as any;

// flatten all menu item labels across groups
const labels = (groups: any[][]) => groups.flat().map((i) => i.label);

const ORIGIN = window.location.origin;

beforeEach(() => {
	authState.user = null;
	authState.loggedIn = false;
	authState.can = vi.fn().mockReturnValue(false);
	toastAdd.mockReset();
	navigateToMock.mockReset();
	// happy-dom navigator.clipboard is read-only; spy instead of replacing
	if (!navigator.clipboard) {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: vi.fn() },
			configurable: true
		});
	}
});

describe('useAdapterMenu', () => {
	it('always includes Open and Copy Link', () => {
		const build = useAdapterMenu();
		const menu = build(adapter());
		expect(labels(menu)).toEqual(expect.arrayContaining(['Open', 'Copy Link']));
	});

	it('includes Copy Install Command only when files are present', () => {
		const build = useAdapterMenu();
		expect(labels(build(adapter()))).toContain('Copy Install Command');
		expect(labels(build(adapter({ weightsBytes: 0 })))).not.toContain('Copy Install Command');
	});

	it('shows Test in Playground for a logged-in user on a testable adapter', () => {
		authState.loggedIn = true;
		const build = useAdapterMenu();
		expect(labels(build(adapter({ status: 'published' })))).toContain('Test in Playground');
		expect(labels(build(adapter({ status: 'draft' })))).not.toContain('Test in Playground');
	});

	it('hides Test in Playground when logged out', () => {
		authState.loggedIn = false;
		const build = useAdapterMenu();
		expect(labels(build(adapter()))).not.toContain('Test in Playground');
	});

	it('returns only the primary group when no manage actions apply', () => {
		const build = useAdapterMenu();
		const menu = build(adapter());
		expect(menu).toHaveLength(1);
	});

	it('shows Edit/Delete for a user with the any-capabilities', () => {
		authState.user = { id: 'x' };
		authState.loggedIn = true;
		authState.can = vi.fn((cap: string) => cap === 'canEditAny' || cap === 'canDeleteAny');
		const build = useAdapterMenu();
		const menu = build(adapter());
		expect(menu).toHaveLength(2);
		expect(labels(menu)).toEqual(expect.arrayContaining(['Edit', 'Delete']));
	});

	it('grants Edit/Delete to the owner with own-capabilities', () => {
		authState.user = { id: 'author-1' };
		authState.loggedIn = true;
		authState.can = vi.fn((cap: string) => cap === 'canEditOwn' || cap === 'canDeleteOwn');
		const build = useAdapterMenu();
		expect(labels(build(adapter({ authorId: 'author-1' })))).toEqual(
			expect.arrayContaining(['Edit', 'Delete'])
		);
	});

	it('denies own-capabilities to a non-owner', () => {
		authState.user = { id: 'someone-else' };
		authState.loggedIn = true;
		authState.can = vi.fn((cap: string) => cap === 'canEditOwn' || cap === 'canDeleteOwn');
		const build = useAdapterMenu();
		expect(labels(build(adapter({ authorId: 'author-1' })))).not.toContain('Edit');
	});

	it('shows Publish only for a listed/failed adapter when onPublish is supplied and permitted', () => {
		authState.can = vi.fn((cap: string) => cap === 'canPublish');
		const onPublish = vi.fn();
		const build = useAdapterMenu({ onPublish });
		expect(labels(build(adapter({ status: 'listed' })))).toContain('Publish');
		expect(labels(build(adapter({ status: 'published' })))).not.toContain('Publish');
	});

	it('does not show Publish without an onPublish handler', () => {
		authState.can = vi.fn((cap: string) => cap === 'canPublish');
		const build = useAdapterMenu();
		expect(labels(build(adapter({ status: 'failed' })))).not.toContain('Publish');
	});

	it('Copy Link writes the absolute url and toasts', () => {
		const writeText = vi
			.spyOn(navigator.clipboard, 'writeText')
			.mockImplementation(() => Promise.resolve());
		const build = useAdapterMenu();
		const menu = build(adapter());
		const copyLink = menu.flat().find((i) => i.label === 'Copy Link');
		copyLink.onSelect();
		expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/adapters/my-lora`);
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link copied' }));
		writeText.mockRestore();
	});

	it('Edit onSelect calls the provided handler', () => {
		authState.user = { id: 'x' };
		authState.loggedIn = true;
		authState.can = vi.fn((cap: string) => cap === 'canEditAny');
		const onEdit = vi.fn();
		const build = useAdapterMenu({ onEdit });
		const menu = build(adapter());
		menu
			.flat()
			.find((i) => i.label === 'Edit')
			.onSelect();
		expect(onEdit).toHaveBeenCalled();
	});

	it('Edit onSelect falls back to navigateTo when no handler', () => {
		authState.user = { id: 'x' };
		authState.loggedIn = true;
		authState.can = vi.fn((cap: string) => cap === 'canEditAny');
		const build = useAdapterMenu();
		const menu = build(adapter());
		menu
			.flat()
			.find((i) => i.label === 'Edit')
			.onSelect();
		expect(navigateToMock).toHaveBeenCalledWith('/adapters/my-lora?edit=1');
	});

	it('Delete onSelect falls back to navigateTo when no handler', () => {
		authState.user = { id: 'x' };
		authState.loggedIn = true;
		authState.can = vi.fn((cap: string) => cap === 'canDeleteAny');
		const build = useAdapterMenu();
		const menu = build(adapter());
		menu
			.flat()
			.find((i) => i.label === 'Delete')
			.onSelect();
		expect(navigateToMock).toHaveBeenCalledWith('/adapters/my-lora?delete=1');
	});
});
