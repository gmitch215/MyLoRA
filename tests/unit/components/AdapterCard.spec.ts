import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Card from '~/components/adapter/Card.vue';

// menu builder needs auth/toast; a stub keeps the card's own rendering the thing under test
mockNuxtImport('useAdapterMenu', () => () => () => [[]]);

const global = {
	stubs: {
		UContextMenu: { template: '<div><slot /></div>' },
		UTooltip: { template: '<div><slot /></div>' }
	}
};

function adapter(extra: Record<string, unknown> = {}) {
	return {
		id: 'a1',
		slug: 'my-lora',
		name: 'My LoRA',
		baseModel: '@cf/google/gemma-2b',
		modelType: 'gemma',
		rank: 16,
		status: 'published',
		tags: [],
		weightsBytes: 4096,
		downloadCount: 3200,
		inferenceCount: 12,
		created_at: Date.now(),
		iconName: null,
		iconColor: null,
		screenshots: [],
		author: null,
		...extra
	} as any;
}

describe('AdapterCard', () => {
	it('renders name, rank, and counts', async () => {
		const w = await mountSuspended(Card, { global, props: { adapter: adapter() } });
		expect(w.text()).toContain('My LoRA');
		expect(w.text()).toContain('rank 16');
		expect(w.text()).toContain('3,200');
		expect(w.text()).toContain('12');
	});

	it('links to the adapter detail page', async () => {
		const w = await mountSuspended(Card, { global, props: { adapter: adapter() } });
		expect(w.html()).toContain('/adapters/my-lora');
	});

	it('shows a thumbnail from the first screenshot', async () => {
		const w = await mountSuspended(Card, {
			global,
			props: { adapter: adapter({ screenshots: ['shot.png'] }) }
		});
		expect(w.html()).toContain('/files/shot.png');
	});

	it('shows a custom icon when set and no screenshot', async () => {
		const w = await mountSuspended(Card, {
			global,
			props: { adapter: adapter({ iconName: 'mdi:robot', iconColor: 'primary' }) }
		});
		expect(w.findComponent({ name: 'UIcon' }).exists()).toBe(true);
	});

	it('hides the status badge for a published adapter', async () => {
		const w = await mountSuspended(Card, { global, props: { adapter: adapter() } });
		expect(w.text()).not.toContain('draft');
	});

	it('shows a status badge for a non-published adapter', async () => {
		const w = await mountSuspended(Card, {
			global,
			props: { adapter: adapter({ status: 'draft' }) }
		});
		expect(w.text()).toContain('draft');
	});

	it('caps visible tags at four and shows an overflow badge', async () => {
		const w = await mountSuspended(Card, {
			global,
			props: { adapter: adapter({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }) }
		});
		expect(w.text()).toContain('+2');
	});

	it('renders the author when present', async () => {
		const w = await mountSuspended(Card, {
			global,
			props: {
				adapter: adapter({ author: { displayName: 'Ann', avatarPathname: null } })
			}
		});
		expect(w.text()).toContain('Ann');
	});
});
