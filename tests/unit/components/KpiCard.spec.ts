import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import KpiCard from '~/components/KpiCard.vue';

describe('KpiCard', () => {
	it('shows a skeleton while loading', async () => {
		const w = await mountSuspended(KpiCard, {
			props: { label: 'Users', value: 5, loading: true }
		});
		expect(w.findComponent({ name: 'USkeleton' }).exists()).toBe(true);
	});

	it('formats plain numbers with locale separators', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'Downloads', value: 1234 } });
		expect(w.text()).toContain('1,234');
	});

	it('formats percent', async () => {
		const w = await mountSuspended(KpiCard, {
			props: { label: 'Rate', value: 0.256, format: 'percent' }
		});
		expect(w.text()).toContain('26%');
	});

	it('formats durations across all branches', async () => {
		const zero = await mountSuspended(KpiCard, {
			props: { label: 'd', value: 0, format: 'duration' }
		});
		expect(zero.text()).toContain('0s');

		const ms = await mountSuspended(KpiCard, {
			props: { label: 'd', value: 500, format: 'duration' }
		});
		expect(ms.text()).toContain('500ms');

		const secs = await mountSuspended(KpiCard, {
			props: { label: 'd', value: 5000, format: 'duration' }
		});
		expect(secs.text()).toContain('5s');

		const mins = await mountSuspended(KpiCard, {
			props: { label: 'd', value: 125000, format: 'duration' }
		});
		expect(mins.text()).toContain('2m 5s');
	});

	it('omits the delta when prev is undefined', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'x', value: 10 } });
		expect(w.text()).not.toContain('%');
	});

	it('shows a dash when both are zero', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'x', value: 0, prev: 0 } });
		expect(w.text()).toContain('-');
	});

	it('shows +inf when prev is zero and value grows', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'x', value: 3, prev: 0 } });
		expect(w.text()).toContain('+inf');
	});

	it('shows a positive delta with success class', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'x', value: 150, prev: 100 } });
		expect(w.text()).toContain('+50%');
		expect(w.html()).toContain('text-success');
	});

	it('shows a negative delta with error class', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'x', value: 50, prev: 100 } });
		expect(w.text()).toContain('-50%');
		expect(w.html()).toContain('text-error');
	});

	it('uses the muted class when equal', async () => {
		const w = await mountSuspended(KpiCard, { props: { label: 'x', value: 100, prev: 100 } });
		expect(w.text()).toContain('+0%');
		expect(w.html()).toContain('text-muted');
	});
});
