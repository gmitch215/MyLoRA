import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ContextMeter from '~/components/ai/ContextMeter.vue';

describe('AiContextMeter', () => {
	it('renders used/total and percent with the default label', async () => {
		const w = await mountSuspended(ContextMeter, { props: { used: 250, total: 1000 } });
		expect(w.text()).toContain('Context Used');
		expect(w.text()).toContain('250');
		expect(w.text()).toContain('1,000');
		expect(w.text()).toContain('25%');
	});

	it('accepts a custom label', async () => {
		const w = await mountSuspended(ContextMeter, {
			props: { used: 10, total: 100, label: 'Tokens' }
		});
		expect(w.text()).toContain('Tokens');
	});

	it('shows 0% when total is zero', async () => {
		const w = await mountSuspended(ContextMeter, { props: { used: 5, total: 0 } });
		expect(w.text()).toContain('0%');
	});

	it('uses the primary bar under 75%', async () => {
		const w = await mountSuspended(ContextMeter, { props: { used: 50, total: 100 } });
		expect(w.html()).toContain('bg-primary');
	});

	it('uses the warning bar between 75 and 90%', async () => {
		const w = await mountSuspended(ContextMeter, { props: { used: 80, total: 100 } });
		expect(w.html()).toContain('bg-warning');
	});

	it('uses the error bar at 90% and above', async () => {
		const w = await mountSuspended(ContextMeter, { props: { used: 95, total: 100 } });
		expect(w.html()).toContain('bg-error');
	});

	it('clamps the bar width to 100%', async () => {
		const w = await mountSuspended(ContextMeter, { props: { used: 200, total: 100 } });
		expect(w.html()).toContain('width: 100%');
	});
});
