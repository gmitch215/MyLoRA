import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import UploadProgress from '~/components/UploadProgress.vue';

describe('UploadProgress', () => {
	it('rounds the percent and renders the label', async () => {
		const w = await mountSuspended(UploadProgress, {
			props: { progress: 42.6, state: 'uploading', label: 'weights.safetensors' }
		});
		expect(w.text()).toContain('43%');
		expect(w.text()).toContain('weights.safetensors');
	});

	it('shows the spinner only while uploading', async () => {
		const up = await mountSuspended(UploadProgress, {
			props: { progress: 10, state: 'uploading' }
		});
		expect(up.findComponent({ name: 'AppSpinner' }).exists()).toBe(true);

		const idle = await mountSuspended(UploadProgress, { props: { progress: 0, state: 'idle' } });
		expect(idle.findComponent({ name: 'AppSpinner' }).exists()).toBe(false);
	});

	it('falls back to the idle icon for an unknown state', async () => {
		const w = await mountSuspended(UploadProgress, { props: { progress: 0, state: 'weird' } });
		// unknown state -> no spinner, renders the icon branch
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(false);
		expect(w.text()).toContain('0%');
	});
});
