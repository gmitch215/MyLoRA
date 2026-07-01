import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ViewsChart from '~/components/analytics/ViewsChart.client.vue';

const stubs = {
	VisXYContainer: true,
	VisLine: true,
	VisArea: true,
	VisAxis: true,
	VisTooltip: true,
	VisCrosshair: true
};

describe('analytics/ViewsChart', () => {
	it('mounts with the default height', async () => {
		const w = await mountSuspended(ViewsChart, {
			props: {
				perDay: [
					{ day: '2026-01-01', views: 5, unique: 3 },
					{ day: '2026-01-02', views: 8, unique: 4 }
				]
			},
			global: { stubs }
		});
		// default height 180 applied to the wrapper style
		expect(w.html()).toContain('height: 180px');
	});

	it('honors a custom height', async () => {
		const w = await mountSuspended(ViewsChart, {
			props: { perDay: [{ day: '2026-01-01', views: 1, unique: 1 }], height: 240 },
			global: { stubs }
		});
		expect(w.html()).toContain('height: 240px');
	});

	it('mounts with an empty series', async () => {
		const w = await mountSuspended(ViewsChart, { props: { perDay: [] }, global: { stubs } });
		expect(w.find('div').exists()).toBe(true);
	});
});
