import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import TextDiff from '~/components/ai/TextDiff.vue';

describe('AiTextDiff', () => {
	it('marks removed words with a strikethrough error style', async () => {
		const w = await mountSuspended(TextDiff, { props: { a: 'the quick fox', b: 'the fox' } });
		expect(w.text()).toContain('quick');
		expect(w.html()).toContain('line-through');
		expect(w.html()).toContain('text-error');
	});

	it('marks inserted words with a success style', async () => {
		const w = await mountSuspended(TextDiff, { props: { a: 'the fox', b: 'the quick fox' } });
		expect(w.text()).toContain('quick');
		expect(w.html()).toContain('text-success');
	});

	it('renders identical text as neutral', async () => {
		const w = await mountSuspended(TextDiff, { props: { a: 'same text', b: 'same text' } });
		expect(w.text()).toContain('same text');
		expect(w.html()).toContain('text-default');
		expect(w.html()).not.toContain('line-through');
	});
});
