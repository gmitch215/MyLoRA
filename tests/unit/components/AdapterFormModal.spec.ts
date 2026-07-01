import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import FormModal from '~/components/adapter/FormModal.vue';

// the inner form is exercised by its own spec; stub it so the modal wiring is what we test.
// UModal teleports to <body>, so stub it to render its slots inline for easy querying.
const global = {
	stubs: {
		AdapterForm: {
			emits: ['cancel', 'submit'],
			template: '<div class="inner-form" />'
		},
		UModal: {
			template: '<div><slot name="header" /><slot name="body" /></div>'
		}
	}
};

describe('AdapterFormModal', () => {
	it('titles the modal for create mode', async () => {
		const w = await mountSuspended(FormModal, {
			global,
			props: { open: true, mode: 'create' }
		});
		expect(w.text()).toContain('New adapter');
	});

	it('titles the modal for edit mode', async () => {
		const w = await mountSuspended(FormModal, {
			global,
			props: { open: true, mode: 'edit' }
		});
		expect(w.text()).toContain('Edit adapter');
	});

	it('toggles fullscreen', async () => {
		const w = await mountSuspended(FormModal, {
			global,
			props: { open: true, mode: 'create' }
		});
		const fsBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('title') === 'Fullscreen');
		await fsBtn!.trigger('click');
		const exitBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('title') === 'Exit Fullscreen');
		expect(exitBtn).toBeTruthy();
	});

	it('closes and emits update:open + close', async () => {
		const w = await mountSuspended(FormModal, {
			global,
			props: { open: true, mode: 'create' }
		});
		const closeBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('title') === 'Close');
		await closeBtn!.trigger('click');
		expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
		expect(w.emitted('close')).toBeTruthy();
	});

	it('forwards the inner form submit', async () => {
		const w = await mountSuspended(FormModal, {
			global,
			props: { open: true, mode: 'create' }
		});
		w.findComponent('.inner-form').vm.$emit('submit', { id: 'x', slug: 'x' });
		await w.vm.$nextTick();
		expect(w.emitted('submit')?.[0]).toEqual([{ id: 'x', slug: 'x' }]);
	});

	it('closes when the inner form cancels', async () => {
		const w = await mountSuspended(FormModal, {
			global,
			props: { open: true, mode: 'create' }
		});
		w.findComponent('.inner-form').vm.$emit('cancel');
		await w.vm.$nextTick();
		expect(w.emitted('close')).toBeTruthy();
	});
});
