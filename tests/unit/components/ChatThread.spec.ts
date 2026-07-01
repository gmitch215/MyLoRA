import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import ChatThread from '~/components/ai/ChatThread.vue';

const global = { stubs: { UTooltip: { template: '<div><slot /></div>' } } };

function node(extra: Record<string, unknown> = {}) {
	return { id: 'n1', role: 'user', content: 'hello', ...extra } as any;
}

describe('AiChatThread', () => {
	it('shows the empty slot when there are no nodes', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: { nodes: [] },
			slots: { empty: 'Nothing here yet' }
		});
		expect(w.text()).toContain('Nothing here yet');
	});

	it('renders a user turn as plain text', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: { nodes: [node({ content: 'ping' })] }
		});
		expect(w.text()).toContain('ping');
	});

	it('renders an assistant turn as markdown html', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: {
				nodes: [node({ id: 'a1', role: 'assistant', content: '**bold**' })]
			}
		});
		expect(w.html()).toContain('<strong>bold</strong>');
	});

	it('hides empty assistant placeholders', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: { nodes: [node({ id: 'a1', role: 'assistant', content: '' })] }
		});
		expect(w.text()).not.toContain('robot');
	});

	it('shows the thinking indicator while loading with no assistant content', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: { nodes: [node({ content: 'q' })], loading: true }
		});
		expect(w.html()).toContain('animate-bounce');
	});

	it('renders a collapsed summary node and toggles it open', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: {
				nodes: [node({ id: 's1', role: 'assistant', content: 'the summary', compacted: true })]
			}
		});
		expect(w.text()).toContain('Earlier Messages Summarized');
		expect(w.text()).not.toContain('the summary');
		await w.find('button').trigger('click');
		expect(w.text()).toContain('the summary');
	});

	it('renders version navigation and emits branch', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: {
				nodes: [
					node({ id: 'a1', role: 'assistant', content: 'v2', versions: { index: 2, count: 3 } })
				]
			}
		});
		expect(w.text()).toContain('2/3');
		const prev = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('aria-label') === 'Previous Version');
		await prev!.trigger('click');
		expect(w.emitted('branch')?.[0]).toEqual([{ id: 'a1', dir: -1 }]);
	});

	it('opens the inline editor and emits edit on save', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: { nodes: [node({ content: 'original' })], editable: true }
		});
		const editBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('aria-label') === 'Edit Message');
		await editBtn!.trigger('click');
		const ta = w.find('textarea');
		await ta.setValue('edited text');
		const save = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('Save & Resend'));
		await save!.trigger('click');
		expect(w.emitted('edit')?.[0]).toEqual([{ id: 'n1', content: 'edited text' }]);
	});

	it('cancels the inline editor without emitting', async () => {
		const w = await mountSuspended(ChatThread, {
			global,
			props: { nodes: [node({ content: 'original' })], editable: true }
		});
		const editBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('aria-label') === 'Edit Message');
		await editBtn!.trigger('click');
		const cancel = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('Cancel'));
		await cancel!.trigger('click');
		expect(w.emitted('edit')).toBeFalsy();
		expect(w.find('textarea').exists()).toBe(false);
	});
});
