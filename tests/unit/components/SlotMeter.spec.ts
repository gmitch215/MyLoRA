import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import SlotMeter from '~/components/cloudflare/SlotMeter.vue';

describe('cloudflare/SlotMeter', () => {
	it('renders used/max and the default label', async () => {
		const w = await mountSuspended(SlotMeter, { props: { used: 10 } });
		expect(w.text()).toContain('10 / 100');
		expect(w.text()).toContain('adapters');
	});

	it('uses a custom label when given', async () => {
		const w = await mountSuspended(SlotMeter, { props: { used: 5, max: 50, label: 'finetunes' } });
		expect(w.text()).toContain('finetunes');
		expect(w.text()).toContain('5 / 50');
	});

	it('does not warn when under 90 percent', async () => {
		const w = await mountSuspended(SlotMeter, { props: { used: 50, max: 100 } });
		// no full message, no warning class on the count span
		expect(w.text()).not.toContain('Account is full');
		expect(w.html()).toContain('text-muted');
	});

	it('flags the warning band at 90 percent', async () => {
		const w = await mountSuspended(SlotMeter, { props: { used: 90, max: 100 } });
		expect(w.html()).toContain('text-warning');
		expect(w.text()).not.toContain('Account is full');
	});

	it('shows the full message when at capacity', async () => {
		const w = await mountSuspended(SlotMeter, { props: { used: 100, max: 100 } });
		expect(w.text()).toContain('Account is full');
	});
});
