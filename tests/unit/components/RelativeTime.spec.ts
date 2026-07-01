import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import RelativeTime from '~/components/RelativeTime.vue';

// UTooltip needs a provider context that isn't set up in unit mounts; render its slot only
const global = { stubs: { UTooltip: { template: '<div><slot /></div>' } } };

describe('RelativeTime', () => {
	it('renders a relative label for a Date', async () => {
		const w = await mountSuspended(RelativeTime, {
			global,
			props: { date: new Date(Date.now() - 60_000) }
		});
		expect(w.text()).toMatch(/ago/);
	});

	it('accepts a millis number', async () => {
		const w = await mountSuspended(RelativeTime, {
			global,
			props: { date: Date.now() - 3600_000 }
		});
		expect(w.text()).toMatch(/ago/);
	});

	it('accepts an iso string', async () => {
		const iso = new Date(Date.now() - 86_400_000).toISOString();
		const w = await mountSuspended(RelativeTime, { global, props: { date: iso } });
		expect(w.text()).toMatch(/ago/);
	});

	it('accepts a numeric string', async () => {
		const w = await mountSuspended(RelativeTime, {
			global,
			props: { date: String(Date.now() - 120_000) }
		});
		expect(w.text()).toMatch(/ago/);
	});

	it('renders nothing for null', async () => {
		const w = await mountSuspended(RelativeTime, { global, props: { date: null } });
		expect(w.find('span').text()).toBe('');
	});

	it('renders nothing for an empty string', async () => {
		const w = await mountSuspended(RelativeTime, { global, props: { date: '' } });
		expect(w.find('span').text()).toBe('');
	});

	it('renders nothing for a non-date string', async () => {
		const w = await mountSuspended(RelativeTime, { global, props: { date: 'not-a-date' } });
		expect(w.find('span').text()).toBe('');
	});

	it('drops the muted class when muted is false', async () => {
		const w = await mountSuspended(RelativeTime, {
			global,
			props: { date: new Date(), muted: false }
		});
		expect(w.find('span').classes()).not.toContain('text-muted');
	});

	it('applies the muted class by default', async () => {
		const w = await mountSuspended(RelativeTime, { global, props: { date: new Date() } });
		expect(w.find('span').classes()).toContain('text-muted');
	});
});
