import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import CompareDiff from '~/components/ai/CompareDiff.vue';

const global = { stubs: { UTooltip: { template: '<div><slot /></div>' } } };

function pairs() {
	return [
		{ question: 'What is 2+2?', a: 'It is four.', b: 'It is five.' },
		{ question: 'Hi', a: 'Hello there friend.', b: 'Hello there friend.' }
	];
}

describe('AiCompareDiff', () => {
	it('shows an empty prompt when there are no pairs', async () => {
		const w = await mountSuspended(CompareDiff, {
			global,
			props: { pairs: [], labelA: 'A', labelB: 'B' }
		});
		expect(w.text()).toContain('Send a prompt to both targets first');
	});

	it('renders the legend with both labels', async () => {
		const w = await mountSuspended(CompareDiff, {
			global,
			props: { pairs: pairs(), labelA: 'Model A', labelB: 'Model B' }
		});
		expect(w.text()).toContain('Only In Model A');
		expect(w.text()).toContain('Only In Model B');
	});

	it('renders a turn per pair with its question', async () => {
		const w = await mountSuspended(CompareDiff, {
			global,
			props: { pairs: pairs(), labelA: 'A', labelB: 'B' }
		});
		expect(w.text()).toContain('Turn 1');
		expect(w.text()).toContain('Turn 2');
		expect(w.text()).toContain('What is 2+2?');
	});

	it('shows diff cells in diff mode', async () => {
		const w = await mountSuspended(CompareDiff, {
			global,
			props: { pairs: pairs(), labelA: 'A', labelB: 'B' }
		});
		expect(w.findAllComponents({ name: 'AiDiffCell' }).length).toBeGreaterThan(0);
	});

	it('toggles to raw mode showing plain answers', async () => {
		const w = await mountSuspended(CompareDiff, {
			global,
			props: { pairs: pairs(), labelA: 'A', labelB: 'B' }
		});
		const toggle = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('Show Raw'));
		await toggle!.trigger('click');
		expect(w.text()).toContain('It is four.');
		expect(w.text()).toContain('It is five.');
		expect(w.text()).toContain('Show Diff');
	});

	it('shows a no-response placeholder in raw mode for empty answers', async () => {
		const w = await mountSuspended(CompareDiff, {
			global,
			props: {
				pairs: [{ question: 'q', a: '', b: '' }],
				labelA: 'A',
				labelB: 'B'
			}
		});
		const toggle = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('Show Raw'));
		await toggle!.trigger('click');
		expect(w.text()).toContain('(no response)');
	});
});
