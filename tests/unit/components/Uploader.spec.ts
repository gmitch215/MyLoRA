import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Uploader from '~/components/screenshot/Uploader.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

describe('screenshot/Uploader', () => {
	it('shows the file upload control when under the max', async () => {
		const w = await mountSuspended(Uploader, {
			props: { adapterId: 'ad1', modelValue: [] }
		});
		// no thumbnails yet, upload control visible with the count label
		expect(w.findComponent({ name: 'UFileUpload' }).exists()).toBe(true);
		expect(w.text()).toContain('Add Screenshot (0/6)');
	});

	it('renders thumbnails and resolves relative paths to the blob route', async () => {
		const w = await mountSuspended(Uploader, {
			props: { adapterId: 'ad1', modelValue: ['adapters/ad1/a.png', 'https://cdn/x.png'] }
		});
		const imgs = w.findAll('img');
		expect(imgs).toHaveLength(2);
		expect(imgs[0]!.attributes('src')).toContain('/files/adapters/ad1/a.png');
		expect(imgs[1]!.attributes('src')).toBe('https://cdn/x.png');
	});

	it('hides the uploader and shows the max message at capacity', async () => {
		const full = Array.from({ length: 6 }, (_, i) => `adapters/ad1/${i}.png`);
		const w = await mountSuspended(Uploader, {
			props: { adapterId: 'ad1', modelValue: full }
		});
		expect(w.findComponent({ name: 'UFileUpload' }).exists()).toBe(false);
		expect(w.text()).toContain('Maximum of 6 screenshots reached.');
	});

	it('deletes a screenshot and emits the updated list', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ screenshots: ['adapters/ad1/b.png'] }));
		const w = await mountSuspended(Uploader, {
			props: { adapterId: 'ad1', modelValue: ['adapters/ad1/a.png', 'adapters/ad1/b.png'] }
		});
		const removeBtn = w
			.findAll('button')
			.find((b) => b.attributes('title') === 'Remove Screenshot');
		await removeBtn!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		const emitted = w.emitted('update:modelValue');
		expect(emitted).toBeTruthy();
		expect(emitted![0]![0]).toEqual(['adapters/ad1/b.png']);
		vi.unstubAllGlobals();
	});

	it('surfaces a delete error in the alert', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { statusMessage: 'nope' } }));
		const w = await mountSuspended(Uploader, {
			props: { adapterId: 'ad1', modelValue: ['adapters/ad1/a.png'] }
		});
		const removeBtn = w
			.findAll('button')
			.find((b) => b.attributes('title') === 'Remove Screenshot');
		await removeBtn!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		expect(w.text()).toContain('nope');
		vi.unstubAllGlobals();
	});
});
