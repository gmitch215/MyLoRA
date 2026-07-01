import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Carousel from '~/components/screenshot/Carousel.vue';

describe('screenshot/Carousel', () => {
	it('renders nothing when there are no screenshots', async () => {
		const w = await mountSuspended(Carousel, { props: { screenshots: [] } });
		expect(w.findComponent({ name: 'UCarousel' }).exists()).toBe(false);
		expect(w.find('img').exists()).toBe(false);
	});

	it('renders a carousel with a blob file url for relative pathnames', async () => {
		const w = await mountSuspended(Carousel, {
			props: { screenshots: ['adapters/abc/shot1.png'] }
		});
		expect(w.findComponent({ name: 'UCarousel' }).exists()).toBe(true);
		const img = w.find('img');
		expect(img.exists()).toBe(true);
		expect(img.attributes('src')).toContain('/files/adapters/abc/shot1.png');
	});

	it('passes absolute http urls through unchanged', async () => {
		const w = await mountSuspended(Carousel, {
			props: { screenshots: ['https://cdn.example.com/x.png'] }
		});
		const img = w.find('img');
		expect(img.attributes('src')).toBe('https://cdn.example.com/x.png');
	});
});
