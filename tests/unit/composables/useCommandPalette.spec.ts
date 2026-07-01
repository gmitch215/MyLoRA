import { describe, expect, it } from 'vitest';
import { useCommandPalette } from '~/composables/useCommandPalette';

describe('useCommandPalette', () => {
	it('defaults to closed', () => {
		const { open } = useCommandPalette();
		expect(open.value).toBe(false);
	});

	it('show opens, hide closes', () => {
		const { open, show, hide } = useCommandPalette();
		show();
		expect(open.value).toBe(true);
		hide();
		expect(open.value).toBe(false);
	});

	it('toggle flips the state', () => {
		const { open, toggle, hide } = useCommandPalette();
		hide();
		toggle();
		expect(open.value).toBe(true);
		toggle();
		expect(open.value).toBe(false);
	});

	it('shares the same useState key across calls', () => {
		const a = useCommandPalette();
		const b = useCommandPalette();
		a.show();
		expect(b.open.value).toBe(true);
		a.hide();
	});
});
