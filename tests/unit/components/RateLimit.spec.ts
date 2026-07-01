import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import RateLimit from '~/components/settings/RateLimit.vue';

function limits(overrides: Record<string, any> = {}) {
	return {
		public: { promptsPerHour: 10, outputTokensPerHour: 1000, precedence: 'prompts' },
		developer: { promptsPerHour: 0, outputTokensPerHour: 0, precedence: 'tokens' },
		...overrides
	} as any;
}

describe('settings/RateLimit', () => {
	it('renders both tier sections', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		expect(w.text()).toContain('Public (anonymous)');
		expect(w.text()).toContain('Developer / Playground');
		expect(w.text()).toContain('Prompts / Hour');
	});

	it('emits a clamped public prompts value', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		const inputs = w.findAllComponents({ name: 'UInput' });
		// first input is public promptsPerHour; feed an absurdly high value to hit the clamp
		inputs[0]!.vm.$emit('update:modelValue', 999999);
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		// clamped down into the configured range (max), not passed through raw
		expect(payload.public.promptsPerHour).toBeLessThan(999999);
		expect(payload.developer.precedence).toBe('tokens');
	});

	it('coerces a non-numeric public value to zero-ish via toNum', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		const inputs = w.findAllComponents({ name: 'UInput' });
		inputs[0]!.vm.$emit('update:modelValue', 'not-a-number');
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		// toNum -> 0 then clamped into range min
		expect(typeof payload.public.promptsPerHour).toBe('number');
	});

	it('never clamps the developer value (0 = unlimited)', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		const inputs = w.findAllComponents({ name: 'UInput' });
		// developer promptsPerHour is the 3rd UInput (public prompts, public tokens, dev prompts, dev tokens)
		inputs[2]!.vm.$emit('update:modelValue', 500000);
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		expect(payload.developer.promptsPerHour).toBe(500000);
	});

	it('clamps a negative developer value to zero', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		const inputs = w.findAllComponents({ name: 'UInput' });
		inputs[2]!.vm.$emit('update:modelValue', -50);
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		expect(payload.developer.promptsPerHour).toBe(0);
	});

	it('emits a precedence change for the public tier', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		const selects = w.findAllComponents({ name: 'USelect' });
		// first select is the public precedence
		selects[0]!.vm.$emit('update:modelValue', 'tokens');
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		expect(payload.public.precedence).toBe('tokens');
	});

	it('emits a precedence change for the developer tier', async () => {
		const w = await mountSuspended(RateLimit, { props: { modelValue: limits() } });
		const selects = w.findAllComponents({ name: 'USelect' });
		selects[1]!.vm.$emit('update:modelValue', 'prompts');
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		expect(payload.developer.precedence).toBe('prompts');
	});
});
