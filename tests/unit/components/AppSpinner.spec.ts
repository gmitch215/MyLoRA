import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import AppSpinner from '~/components/AppSpinner.vue';

describe('AppSpinner', () => {
	it('defaults to the sm size class', async () => {
		const w = await mountSuspended(AppSpinner);
		expect(w.attributes('class')).toContain('size-3.5');
		expect(w.attributes('role')).toBe('status');
	});

	it('maps each known size to its class', async () => {
		const cases: Record<string, string> = {
			xs: 'size-3',
			sm: 'size-3.5',
			md: 'size-4',
			lg: 'size-8'
		};
		for (const [size, cls] of Object.entries(cases)) {
			const w = await mountSuspended(AppSpinner, { props: { size: size as any } });
			expect(w.attributes('class')).toContain(cls);
		}
	});

	it('falls back to sm for an unknown size', async () => {
		const w = await mountSuspended(AppSpinner, { props: { size: 'weird' as any } });
		expect(w.attributes('class')).toContain('size-3.5');
	});
});
