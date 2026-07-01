import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import MetricChart from '~/components/training/job/MetricChart.vue';

const base = {
	title: 'Loss',
	xLabel: 'Epoch',
	yLabel: 'Loss',
	legend: 'loss legend'
};

describe('training/job/MetricChart', () => {
	it('renders nothing with fewer than two points', async () => {
		const w = await mountSuspended(MetricChart, { props: { ...base, points: [{ x: 0, y: 1 }] } });
		// ok computed is false -> no svg
		expect(w.find('svg').exists()).toBe(false);
	});

	it('renders the svg, title, legend and a polyline for two or more points', async () => {
		const w = await mountSuspended(MetricChart, {
			props: {
				...base,
				points: [
					{ x: 0, y: 1 },
					{ x: 1, y: 0.5 },
					{ x: 2, y: 0.25 }
				]
			}
		});
		expect(w.find('svg').exists()).toBe(true);
		expect(w.text()).toContain('Loss');
		expect(w.text()).toContain('loss legend');
		const poly = w.find('polyline');
		expect(poly.exists()).toBe(true);
		expect(poly.attributes('points')!.split(' ')).toHaveLength(3);
	});

	it('shows the final label when provided', async () => {
		const w = await mountSuspended(MetricChart, {
			props: {
				...base,
				finalLabel: '0.2500',
				points: [
					{ x: 0, y: 1 },
					{ x: 1, y: 0.25 }
				]
			}
		});
		expect(w.text()).toContain('0.2500');
	});

	it('handles a flat series (all equal y) without crashing', async () => {
		const w = await mountSuspended(MetricChart, {
			props: {
				...base,
				points: [
					{ x: 0, y: 5 },
					{ x: 1, y: 5 },
					{ x: 2, y: 5 }
				]
			}
		});
		expect(w.find('svg').exists()).toBe(true);
		// flat series still draws a polyline
		expect(w.find('polyline').exists()).toBe(true);
	});

	it('thins markers for a dense series but keeps every line point', async () => {
		const points = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i) }));
		const w = await mountSuspended(MetricChart, { props: { ...base, points } });
		// line uses all 200 points
		expect(w.find('polyline').attributes('points')!.split(' ')).toHaveLength(200);
		// markers are capped (<= 61: limit + a trailing last point)
		const markerGroups = w.findAll('g.point');
		expect(markerGroups.length).toBeLessThanOrEqual(61);
		expect(markerGroups.length).toBeGreaterThan(0);
	});

	it('applies a custom y formatter', async () => {
		const w = await mountSuspended(MetricChart, {
			props: {
				...base,
				yFormat: (n: number) => n.toExponential(1),
				points: [
					{ x: 0, y: 0.001 },
					{ x: 1, y: 0.0005 }
				]
			}
		});
		// exponential formatting shows up in the y tick labels
		expect(w.text()).toContain('e-');
	});
});
