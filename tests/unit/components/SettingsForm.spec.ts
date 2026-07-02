import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsForm from '~/components/settings/Form.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

const loaded = {
	name: 'MyLoRA',
	description: 'a registry',
	author: 'Greg',
	message: { text: 'hello banner', type: 'info', icon: 'mdi:information-outline' },
	access: {},
	permissions: {},
	rateLimits: {},
	limits: {},
	features: {}
};

async function flush() {
	// let the async onMounted (store fetch + state assignment) settle across a few turns
	for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('settings/Form', () => {
	it('shows the loading spinner while settings load', async () => {
		// a never-resolving fetch keeps initialLoading true
		vi.stubGlobal('$fetch', vi.fn().mockReturnValue(new Promise(() => {})));
		const w = await mountSuspended(SettingsForm);
		expect(w.text()).toContain('Loading settings...');
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(true);
		vi.unstubAllGlobals();
	});

	it('renders the branding + sections once loaded', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(loaded));
		const w = await mountSuspended(SettingsForm);
		await flush();
		await w.vm.$nextTick();
		expect(w.text()).toContain('Branding');
		expect(w.text()).toContain('Permissions');
		expect(w.text()).toContain('Rate Limits');
		expect(w.text()).toContain('Features');
		expect(w.text()).toContain('Save Settings');
		// the limits + banner sections render in the loaded form
		expect(w.text()).toContain('Max Rank');
		expect(w.text()).toContain('Banner Message');
		vi.unstubAllGlobals();
	});

	it('renders the child matrix and rate-limit components', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(loaded));
		const w = await mountSuspended(SettingsForm);
		await flush();
		await w.vm.$nextTick();
		expect(w.findComponent({ name: 'SettingsPermissionMatrix' }).exists()).toBe(true);
		expect(w.findComponent({ name: 'SettingsRateLimit' }).exists()).toBe(true);
		vi.unstubAllGlobals();
	});

	it('renders a favicon uploader and previews a stored data-url favicon', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ ...loaded, favicon: 'data:image/png;base64,iVBORw0KGgo=' })
		);
		const w = await mountSuspended(SettingsForm);
		// wait until the async load populated the form body (the uploader appears once loaded)
		for (let i = 0; i < 10 && !w.find('input[type="file"]').exists(); i++) {
			await flush();
			await w.vm.$nextTick();
		}
		// the upload control exists (data-url conversion happens on file select)
		expect(w.find('input[type="file"]').exists()).toBe(true);
		// the stored data-url favicon renders in a preview img
		const srcs = w.findAll('img').map((i) => i.attributes('src') || '');
		expect(srcs.some((s) => s.startsWith('data:image/png'))).toBe(true);
		vi.unstubAllGlobals();
	});

	it('emits cancel from the cancel button', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(loaded));
		const w = await mountSuspended(SettingsForm);
		await flush();
		await w.vm.$nextTick();
		const cancel = w.findAll('button').find((b) => b.text().trim() === 'Cancel');
		await cancel!.trigger('click');
		expect(w.emitted('cancel')).toBeTruthy();
		vi.unstubAllGlobals();
	});
});
