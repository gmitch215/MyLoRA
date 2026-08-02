import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import VersusThread from '~/components/ai/VersusThread.vue';

const LABELS = { a: 'LoRA: snark', b: 'Base: mistral' };

function message(side: 'a' | 'b', content: string, id = `${side}-${content}`) {
	return { id, side, content };
}

const stubs = { UTooltip: { template: '<div><slot /></div>' } };

describe('VersusThread', () => {
	it('shows the empty slot when there is nothing yet', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [], labels: LABELS },
			global: { stubs }
		});
		expect(w.text()).toContain('Pick two targets and start the match');
	});

	it('renders the topic banner only when a topic is set', async () => {
		const without = await mountSuspended(VersusThread, {
			props: { messages: [], labels: LABELS },
			global: { stubs }
		});
		expect(without.text()).not.toContain('Topic');

		const withTopic = await mountSuspended(VersusThread, {
			props: { messages: [], labels: LABELS, topic: 'tabs or spaces' },
			global: { stubs }
		});
		expect(withTopic.text()).toContain('Topic');
		expect(withTopic.text()).toContain('tabs or spaces');
	});

	it('labels each side and numbers the messages in order', async () => {
		const w = await mountSuspended(VersusThread, {
			props: {
				messages: [message('a', 'first'), message('b', 'second')],
				labels: LABELS
			},
			global: { stubs }
		});
		expect(w.text()).toContain('LoRA: snark');
		expect(w.text()).toContain('Base: mistral');
		expect(w.text()).toContain('#1');
		expect(w.text()).toContain('#2');
	});

	it('falls back to generic side names when a label is blank', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [message('a', 'x'), message('b', 'y')], labels: { a: '', b: '' } },
			global: { stubs }
		});
		expect(w.text()).toContain('Agent A');
		expect(w.text()).toContain('Agent B');
	});

	it('mirrors side b to the opposite edge', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [message('a', 'left'), message('b', 'right')], labels: LABELS },
			global: { stubs }
		});
		const rows = w.findAll('div.group');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.classes()).toContain('flex-row');
		expect(rows[1]!.classes()).toContain('flex-row-reverse');
	});

	it('renders assistant markdown as html', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [message('a', '**bold**')], labels: LABELS },
			global: { stubs }
		});
		expect(w.html()).toContain('<strong>bold</strong>');
	});

	it('shows the bouncing placeholder for a message with no content yet', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [message('a', '')], labels: LABELS, running: true },
			global: { stubs }
		});
		expect(w.findAll('.animate-bounce')).toHaveLength(3);
	});

	it('shows the between-turns hint only while running with a finished last message', async () => {
		const between = await mountSuspended(VersusThread, {
			props: { messages: [message('a', 'done')], labels: LABELS, running: true },
			global: { stubs }
		});
		expect(between.text()).toContain('Waiting for the next reply');

		const idle = await mountSuspended(VersusThread, {
			props: { messages: [message('a', 'done')], labels: LABELS, running: false },
			global: { stubs }
		});
		expect(idle.text()).not.toContain('Waiting for the next reply');
	});

	it('is announced as a polite live log', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [], labels: LABELS },
			global: { stubs }
		});
		const root = w.find('[role="log"]');
		expect(root.exists()).toBe(true);
		expect(root.attributes('aria-live')).toBe('polite');
		expect(root.attributes('aria-label')).toBe('Versus Transcript');
	});

	it('gives every copy button an accessible name and keeps it out of hover-only hiding', async () => {
		const w = await mountSuspended(VersusThread, {
			props: { messages: [message('a', 'copy me')], labels: LABELS },
			global: { stubs }
		});
		const copy = w.find('button[aria-label="Copy Message"]');
		expect(copy.exists()).toBe(true);
		// hover-reveal is a css-only affordance gated behind (hover: hover); touch keeps it visible
		expect(copy.classes()).toContain('hover-reveal');
	});
});
