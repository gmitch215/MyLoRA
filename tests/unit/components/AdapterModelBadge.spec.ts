import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ModelBadge from '~/components/adapter/ModelBadge.vue';

describe('AdapterModelBadge', () => {
	it('renders the type text', async () => {
		const w = await mountSuspended(ModelBadge, { props: { type: 'mistral' as any } });
		expect(w.text()).toContain('mistral');
	});

	it('maps each known model family to a color', async () => {
		for (const type of ['mistral', 'gemma', 'llama', 'qwen'] as const) {
			const w = await mountSuspended(ModelBadge, { props: { type: type as any } });
			expect(w.text()).toContain(type);
		}
	});

	it('falls back to neutral for an unknown type', async () => {
		const w = await mountSuspended(ModelBadge, { props: { type: 'unknown' as any } });
		expect(w.text()).toContain('unknown');
	});
});
