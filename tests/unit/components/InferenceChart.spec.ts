import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import InferenceChart from '~/components/analytics/InferenceChart.client.vue';

const stubs = {
	VisXYContainer: true,
	VisLine: true,
	VisArea: true,
	VisAxis: true,
	VisTooltip: true,
	VisCrosshair: true
};

describe('analytics/InferenceChart', () => {
	it('mounts with the default height', async () => {
		const w = await mountSuspended(InferenceChart, {
			props: {
				perDay: [
					{ day: '2026-01-01', total: 3 },
					{ day: '2026-01-02', total: 6 }
				]
			},
			global: { stubs }
		});
		expect(w.html()).toContain('height: 180px');
	});

	it('honors a custom height', async () => {
		const w = await mountSuspended(InferenceChart, {
			props: { perDay: [{ day: '2026-01-01', total: 1 }], height: 300 },
			global: { stubs }
		});
		expect(w.html()).toContain('height: 300px');
	});

	it('mounts with an empty series', async () => {
		const w = await mountSuspended(InferenceChart, { props: { perDay: [] }, global: { stubs } });
		expect(w.find('div').exists()).toBe(true);
	});
});
