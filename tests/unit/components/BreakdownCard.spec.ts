import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import BreakdownCard from '~/components/analytics/BreakdownCard.vue';

describe('analytics/BreakdownCard', () => {
	it('renders the title', async () => {
		const w = await mountSuspended(BreakdownCard, { props: { title: 'Devices', counts: {} } });
		expect(w.text()).toContain('Devices');
	});

	it('shows the skeleton loading state', async () => {
		const w = await mountSuspended(BreakdownCard, {
			props: { title: 'X', counts: { a: 1 }, loading: true }
		});
		// loading branch: skeleton present, no rows
		expect(w.findComponent({ name: 'USkeleton' }).exists()).toBe(true);
		expect(w.text()).not.toContain('No data.');
	});

	it('shows the empty state when there are no entries', async () => {
		const w = await mountSuspended(BreakdownCard, { props: { title: 'X', counts: {} } });
		expect(w.text()).toContain('No data.');
	});

	it('renders rows sorted by value with computed percentages', async () => {
		const w = await mountSuspended(BreakdownCard, {
			props: { title: 'Models', counts: { small: 1, big: 3 } }
		});
		const text = w.text();
		// total 4 -> big 3 (75%), small 1 (25%)
		expect(text).toContain('big');
		expect(text).toContain('3 (75%)');
		expect(text).toContain('1 (25%)');
		// big sorts before small
		expect(text.indexOf('big')).toBeLessThan(text.indexOf('small'));
	});

	it('caps the list at six rows', async () => {
		const counts: Record<string, number> = {};
		for (let i = 0; i < 10; i++) counts[`k${i}`] = i + 1;
		const w = await mountSuspended(BreakdownCard, { props: { title: 'Many', counts } });
		expect(w.findAll('li')).toHaveLength(6);
	});
});
