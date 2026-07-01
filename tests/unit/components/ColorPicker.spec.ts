import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ColorPicker from '~/components/ColorPicker.vue';

describe('ColorPicker', () => {
	it('shows the no-color label when empty', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: '' } });
		expect(w.text()).toContain('No Color Selected');
	});

	it('capitalizes a nuxt color token label', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: 'primary' } });
		expect(w.text()).toContain('Primary');
	});

	it('uppercases a hex label', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: '#3b82f6' } });
		expect(w.text()).toContain('#3B82F6');
	});

	it('treats an unrecognized value as no color', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: 'garbage' } });
		expect(w.text()).toContain('No Color Selected');
	});

	it('emits a preset color on swatch click', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: '' } });
		await w.findAll('button[type="button"]')[0]!.trigger('click');
		expect(w.emitted('update:modelValue')?.[0]).toEqual(['primary']);
	});

	it('emits the trimmed value from the hex input', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: '#111111' } });
		const input = w.findComponent({ name: 'UInput' });
		input.vm.$emit('update:model-value', '  #abcabc  ');
		await w.vm.$nextTick();
		expect(w.emitted('update:modelValue')?.some((e) => e[0] === '#abcabc')).toBe(true);
	});

	it('emits the picked color from the native input', async () => {
		const w = await mountSuspended(ColorPicker, { props: { modelValue: '#000000' } });
		const native = w.find('input[type="color"]');
		(native.element as HTMLInputElement).value = '#ff0000';
		await native.trigger('input');
		expect(w.emitted('update:modelValue')?.some((e) => e[0] === '#ff0000')).toBe(true);
	});

	it('shows a clear button only when clearable and a value is set', async () => {
		const none = await mountSuspended(ColorPicker, {
			props: { modelValue: '', clearable: true }
		});
		expect(none.findComponent({ name: 'UButton' }).exists()).toBe(false);

		const some = await mountSuspended(ColorPicker, {
			props: { modelValue: 'primary', clearable: true }
		});
		const btn = some.findComponent({ name: 'UButton' });
		expect(btn.exists()).toBe(true);
		await btn.trigger('click');
		expect(some.emitted('update:modelValue')?.some((e) => e[0] === '')).toBe(true);
	});
});
