import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import DiffCell from '~/components/ai/DiffCell.vue';

describe('AiDiffCell', () => {
	it('renders a dash and neutral background when text is null', async () => {
		const w = await mountSuspended(DiffCell, {
			props: { left: null, right: 'hi', side: 'left' }
		});
		expect(w.html()).toContain('bg-default/40');
		// null text renders the italic muted placeholder span
		expect(w.find('span.italic').exists()).toBe(true);
	});

	it('shows the left text with removed words highlighted', async () => {
		const w = await mountSuspended(DiffCell, {
			props: { left: 'the quick fox', right: 'the slow fox', side: 'left' }
		});
		expect(w.text()).toContain('quick');
		expect(w.html()).toContain('bg-error/10');
		// left side does not render inserted-only tokens
		expect(w.text()).not.toContain('slow');
	});

	it('shows the right text with inserted words highlighted', async () => {
		const w = await mountSuspended(DiffCell, {
			props: { left: 'the quick fox', right: 'the slow fox', side: 'right' }
		});
		expect(w.text()).toContain('slow');
		expect(w.html()).toContain('bg-success/10');
		expect(w.text()).not.toContain('quick');
	});

	it('treats an empty string as visible text, not null', async () => {
		const w = await mountSuspended(DiffCell, {
			props: { left: '', right: 'x', side: 'left' }
		});
		// empty string is not null, so no dash and left background applies
		expect(w.html()).not.toContain('mdash');
		expect(w.html()).toContain('bg-error/10');
	});
});
