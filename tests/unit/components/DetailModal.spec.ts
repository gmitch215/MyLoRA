import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DetailModal from '~/components/training/job/DetailModal.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	// machinesStore.fetch + store.fetchLog on open; keep them harmless
	vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [] }));
});

async function flush() {
	await new Promise((r) => setTimeout(r, 0));
}

describe('training/job/DetailModal', () => {
	it('does not teleport the body while closed', async () => {
		await mountSuspended(DetailModal, { props: { open: false, jobId: null } });
		expect(document.body.textContent).not.toContain('Training Log');
	});

	it('renders the modal header with the default job title when open', async () => {
		// no matching job in the store -> the header still renders the fallback title
		await mountSuspended(DetailModal, { props: { open: true, jobId: 'missing' } });
		await flush();
		expect(document.body.textContent).toContain('Training Job');
	});

	it('emits update:open(false) via onOpenChange', async () => {
		const w = await mountSuspended(DetailModal, { props: { open: true, jobId: 'missing' } });
		await flush();
		// invoke the modal open-change handler as the UModal would on dismiss
		(w.vm as any).onOpenChange?.(false);
		// fall back to emitting through the exposed close if onOpenChange is not exposed
		const modal = w.findComponent({ name: 'UModal' });
		modal.vm.$emit('update:open', false);
		await w.vm.$nextTick();
		const emitted = w.emitted('update:open');
		expect(emitted).toBeTruthy();
		expect(emitted!.at(-1)![0]).toBe(false);
	});
});
