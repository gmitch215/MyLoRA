import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import Avatar from '~/components/Avatar.vue';

describe('Avatar', () => {
	it('renders an image from a raw pathname', async () => {
		const w = await mountSuspended(Avatar, {
			props: { pathname: 'me.png', displayName: 'Greg' }
		});
		const img = w.find('img');
		expect(img.exists()).toBe(true);
		expect(img.attributes('src')).toBe('/avatars/me.png');
		expect(img.attributes('alt')).toBe('Greg avatar');
	});

	it('passes absolute urls through unencoded', async () => {
		const w = await mountSuspended(Avatar, { props: { pathname: 'https://cdn/x.png' } });
		expect(w.find('img').attributes('src')).toBe('https://cdn/x.png');
		expect(w.find('img').attributes('alt')).toBe('avatar');
	});

	it('reads the avatar pathname off a user object', async () => {
		const w = await mountSuspended(Avatar, {
			props: { user: { avatarPathname: 'u.png', displayName: 'Ann' } as any }
		});
		expect(w.find('img').attributes('src')).toBe('/avatars/u.png');
	});

	it('hides the image after a load error', async () => {
		const w = await mountSuspended(Avatar, { props: { pathname: 'x.png' } });
		await w.find('img').trigger('error');
		expect(w.find('img').classes()).toContain('invisible');
	});

	it('renders an icon when no image and icon is set', async () => {
		const w = await mountSuspended(Avatar, {
			props: { icon: 'mdi:account', iconColor: 'primary' }
		});
		expect(w.find('img').exists()).toBe(false);
		expect(w.findComponent({ name: 'UIcon' }).exists()).toBe(true);
	});

	it('falls back to the initial when no image or icon', async () => {
		const w = await mountSuspended(Avatar, { props: { displayName: 'zed' } });
		expect(w.text()).toContain('Z');
	});

	it('uses ? when there is no name at all', async () => {
		const w = await mountSuspended(Avatar);
		expect(w.text()).toContain('?');
	});

	it('applies size classes for each size', async () => {
		for (const [size, cls] of [
			['2xs', 'h-5'],
			['xs', 'h-6'],
			['sm', 'h-8'],
			['md', 'h-10'],
			['lg', 'h-16'],
			['xl', 'h-24']
		] as const) {
			const w = await mountSuspended(Avatar, { props: { size } });
			expect(w.attributes('class')).toContain(cls);
		}
	});

	it('renders a large initial for xl', async () => {
		const w = await mountSuspended(Avatar, { props: { displayName: 'ab', size: 'xl' } });
		expect(w.find('span').classes()).toContain('text-3xl');
	});
});
