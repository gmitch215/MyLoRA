import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ToolingFields from '~/components/tooling/Fields.vue';
import { DEFAULT_TOOLING } from '~/shared/defaults';

const last = (w: Awaited<ReturnType<typeof mountSuspended>>) => {
	const events = w.emitted('update:modelValue') as unknown[][];
	return events.at(-1)![0];
};

const input = (w: Awaited<ReturnType<typeof mountSuspended>>, label: string) =>
	w
		.findAllComponents({ name: 'UFormField' })
		.find((f) => f.props('label') === label)!
		.find('input').element as HTMLInputElement;

describe('tooling/Fields', () => {
	it('shows every field with its current value', async () => {
		const w = await mountSuspended(ToolingFields, {
			props: { modelValue: { ...DEFAULT_TOOLING } }
		});
		for (const label of [
			'Install Missing Tools',
			'Python Version',
			'vLLM Version',
			'cloudflared Version',
			'Download Attempts',
			'Network Wait (Minutes)',
			'Bandwidth Limit (kB/s)'
		]) {
			expect(w.text()).toContain(label);
		}
		expect(input(w, 'vLLM Version').value).toBe(DEFAULT_TOOLING.vllmVersion);
		expect(input(w, 'Download Attempts').value).toBe(String(DEFAULT_TOOLING.downloadRetries));
	});

	it('emits the whole object with the one field changed', async () => {
		const w = await mountSuspended(ToolingFields, {
			props: { modelValue: { ...DEFAULT_TOOLING } }
		});
		const el = input(w, 'vLLM Version');
		el.value = '0.30.0';
		el.dispatchEvent(new Event('input'));
		expect(last(w)).toEqual({ ...DEFAULT_TOOLING, vllmVersion: '0.30.0' });
	});

	it('emits a number for a numeric field and drops the key when it is blanked', async () => {
		const w = await mountSuspended(ToolingFields, {
			props: { modelValue: { ...DEFAULT_TOOLING } }
		});
		const el = input(w, 'Download Attempts');
		el.value = '3';
		el.dispatchEvent(new Event('input'));
		expect(last(w)).toMatchObject({ downloadRetries: 3 });
		el.value = '';
		el.dispatchEvent(new Event('input'));
		expect(last(w)).not.toHaveProperty('downloadRetries');
	});

	it('uses the inherited values as placeholders, so a blank field reads as inheriting', async () => {
		const inherit = { ...DEFAULT_TOOLING, vllmVersion: '0.29.0', downloadRetries: 7 };
		const w = await mountSuspended(ToolingFields, { props: { modelValue: {}, inherit } });
		const vllm = input(w, 'vLLM Version');
		expect(vllm.value).toBe('');
		expect(vllm.placeholder).toBe('0.29.0');
		expect(input(w, 'Download Attempts').placeholder).toBe('7');
	});

	it('offers a use-settings choice only when overriding, and shows what it would inherit', async () => {
		const settings = await mountSuspended(ToolingFields, {
			props: { modelValue: { ...DEFAULT_TOOLING } }
		});
		expect(settings.text()).not.toContain('Use Settings');

		const off = await mountSuspended(ToolingFields, {
			props: { modelValue: {}, inherit: { ...DEFAULT_TOOLING, autoInstall: false } }
		});
		expect(off.text()).toContain('Use Settings (Off)');
		const on = await mountSuspended(ToolingFields, {
			props: { modelValue: {}, inherit: { ...DEFAULT_TOOLING } }
		});
		expect(on.text()).toContain('Use Settings (On)');
	});
});
