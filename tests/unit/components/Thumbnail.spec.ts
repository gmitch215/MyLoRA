import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Thumbnail from '~/components/Thumbnail.vue';

describe('Thumbnail', () => {
	it('renders a bare image when there is no link', async () => {
		const w = await mountSuspended(Thumbnail, { props: { src: '/a.png', alt: 'a' } });
		const img = w.find('img');
		expect(img.exists()).toBe(true);
		expect(img.attributes('src')).toBe('/a.png');
		expect(img.attributes('loading')).toBe('lazy');
		expect(img.attributes('decoding')).toBe('async');
	});

	it('wraps in a link when to is set', async () => {
		const w = await mountSuspended(Thumbnail, { props: { src: '/a.png', to: '/x' } });
		expect(w.findComponent({ name: 'NuxtLink' }).exists()).toBe(true);
	});

	it('uses eager loading attributes when eager', async () => {
		const w = await mountSuspended(Thumbnail, { props: { src: '/a.png', eager: true } });
		const img = w.find('img');
		expect(img.attributes('loading')).toBe('eager');
		expect(img.attributes('decoding')).toBe('sync');
		expect(img.attributes('fetchpriority')).toBe('high');
	});

	it('falls back to the default when src is missing', async () => {
		const w = await mountSuspended(Thumbnail, { props: { src: null } });
		expect(w.find('img').attributes('src')).toBe('/favicon.png');
	});

	it('falls back to a custom fallback on error', async () => {
		const w = await mountSuspended(Thumbnail, {
			props: { src: '/broken.png', fallback: '/fb.png' }
		});
		await w.find('img').trigger('error');
		expect(w.find('img').attributes('src')).toBe('/fb.png');
	});

	it('drops the rounded class when rounded is false', async () => {
		const w = await mountSuspended(Thumbnail, { props: { src: '/a.png', rounded: false } });
		expect(w.find('img').classes()).not.toContain('rounded-md');
	});
});
