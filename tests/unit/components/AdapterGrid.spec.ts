import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Grid from '~/components/adapter/Grid.vue';

// AdapterCard pulls in stores/context menus; stub it so the Grid's own branches are what we test
const global = { stubs: { AdapterCard: { template: '<div class="stub-card" />' } } };

function adapter(id: string) {
	return {
		id,
		slug: id,
		name: id,
		baseModel: '@cf/x/y',
		modelType: 'mistral',
		rank: 8,
		status: 'published',
		tags: [],
		weightsBytes: 0,
		downloadCount: 0,
		inferenceCount: 0,
		created_at: Date.now()
	} as any;
}

describe('AdapterGrid', () => {
	it('renders skeletons while loading with no adapters', async () => {
		const w = await mountSuspended(Grid, {
			global,
			props: { adapters: [], loading: true }
		});
		expect(w.findAllComponents({ name: 'USkeleton' }).length).toBeGreaterThan(0);
	});

	it('renders a card per adapter', async () => {
		const w = await mountSuspended(Grid, {
			global,
			props: { adapters: [adapter('a'), adapter('b')] }
		});
		expect(w.findAll('.stub-card').length).toBe(2);
	});

	it('shows the empty state when there are no adapters', async () => {
		const w = await mountSuspended(Grid, { global, props: { adapters: [] } });
		expect(w.text()).toContain('No adapters yet.');
	});

	it('shows cards over skeletons when loading but adapters exist', async () => {
		const w = await mountSuspended(Grid, {
			global,
			props: { adapters: [adapter('a')], loading: true }
		});
		expect(w.findAll('.stub-card').length).toBe(1);
		expect(w.findAllComponents({ name: 'USkeleton' }).length).toBe(0);
	});
});
