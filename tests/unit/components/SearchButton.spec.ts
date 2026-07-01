import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import SearchButton from '~/components/SearchButton.vue';
import { useCommandPalette } from '~/composables/useCommandPalette';

describe('SearchButton', () => {
	it('renders the label and shortcut when expanded', async () => {
		const w = await mountSuspended(SearchButton);
		expect(w.text()).toContain('Search');
		expect(w.findAllComponents({ name: 'UKbd' }).length).toBe(2);
	});

	it('hides the label and shortcut when collapsed', async () => {
		const w = await mountSuspended(SearchButton, { props: { collapsed: true } });
		expect(w.text()).not.toContain('Search');
		expect(w.findAllComponents({ name: 'UKbd' }).length).toBe(0);
	});

	it('opens the command palette on click', async () => {
		const w = await mountSuspended(SearchButton);
		const { open } = useCommandPalette();
		open.value = false;
		await w.find('button').trigger('click');
		expect(open.value).toBe(true);
	});
});
