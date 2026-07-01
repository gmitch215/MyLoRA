import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import BaseBadge from '~/components/adapter/BaseBadge.vue';

// UTooltip needs a provider not present in unit mounts; render only its slot
const global = { stubs: { UTooltip: { template: '<div><slot /></div>' } } };

describe('AdapterBaseBadge', () => {
	it('shows the last path segment of a model id', async () => {
		const w = await mountSuspended(BaseBadge, {
			global,
			props: { model: '@cf/google/gemma-2b-it-lora' }
		});
		expect(w.text()).toContain('gemma-2b-it-lora');
	});

	it('falls back to the full id when there is no slash', async () => {
		const w = await mountSuspended(BaseBadge, { global, props: { model: 'plain-model' } });
		expect(w.text()).toContain('plain-model');
	});

	it('handles trailing slashes', async () => {
		const w = await mountSuspended(BaseBadge, { global, props: { model: 'a/b/c/' } });
		expect(w.text()).toContain('c');
	});
});
