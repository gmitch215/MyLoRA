import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import PlaygroundChat from '~/components/ai/PlaygroundChat.vue';

// inference store: path lookups return per-key arrays; actions are spies
const paths: Record<string, any[]> = {};
const loadingKeys = new Set<string>();
const hydrate = vi.fn();
const clear = vi.fn();
const stop = vi.fn();
const branch = vi.fn();
const sendPlayground = vi.fn().mockResolvedValue(undefined);
const editPlayground = vi.fn().mockResolvedValue(undefined);

const inference = {
	sessions: {} as Record<string, any>,
	hydrate,
	pathOf: (k: string) => paths[k] ?? [],
	isLoading: (k: string) => loadingKeys.has(k),
	clear,
	stop,
	branch,
	sendPlayground,
	editPlayground
};
mockNuxtImport('useInferenceStore', () => () => inference);

const limits = ref<any>({ maxOutputTokens: 512, maxSystemPromptChars: 500 });
mockNuxtImport('useSettingsStore', () => () => ({ limits }));
mockNuxtImport('storeToRefs', () => (s: any) => s);

const copy = vi.fn();
const download = vi.fn();
mockNuxtImport('useChatExport', () => () => ({ copy, download, copied: ref(false) }));

const global = {
	stubs: {
		UTooltip: { template: '<div><slot /></div>' },
		UChatPrompt: {
			props: ['modelValue'],
			emits: ['update:modelValue', 'submit', 'stop'],
			template: '<div class="chat-prompt"><slot /></div>'
		},
		UChatPromptSubmit: { template: '<button class="submit" />' },
		USelectMenu: { template: '<div class="select" />' },
		UModal: { template: '<div><slot name="body" /></div>' }
	}
};

const models = [
	{ model: '@cf/google/gemma-2b', modelType: 'gemma' },
	{ model: '@cf/meta/llama-3', modelType: 'llama' }
];
const adapters = {
	items: [
		{
			id: 'ad1',
			name: 'My LoRA',
			slug: 'my-lora',
			baseModel: '@cf/google/gemma-2b',
			status: 'published'
		}
	]
};

function stubFetch() {
	vi.stubGlobal(
		'$fetch',
		vi.fn().mockImplementation((url: string) => {
			if (url === '/api/infer/models') return Promise.resolve(models);
			if (url === '/api/adapters/list') return Promise.resolve(adapters);
			return Promise.resolve({});
		})
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	for (const k of Object.keys(paths)) delete paths[k];
	loadingKeys.clear();
	limits.value = { maxOutputTokens: 512, maxSystemPromptChars: 500 };
	localStorage.clear();
	stubFetch();
});

const flush = () => new Promise((r) => setTimeout(r, 30));

describe('AiPlaygroundChat', () => {
	it('renders the mode toggle and hydrates the store on mount', async () => {
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		expect(hydrate).toHaveBeenCalled();
		expect(w.text()).toContain('Single');
		expect(w.text()).toContain('Compare');
	});

	it('shows one pane in single mode', async () => {
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		expect(w.findAll('.select').length).toBe(1);
	});

	it('switches to compare mode showing two panes and the hint', async () => {
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		const compareBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().trim() === 'Compare');
		await compareBtn!.trigger('click');
		await flush();
		expect(w.findAll('.select').length).toBe(2);
		expect(w.text()).toContain('Send one prompt to two targets');
	});

	it('clamps max tokens to the ceiling from limits', async () => {
		limits.value = { maxOutputTokens: 100, maxSystemPromptChars: 500 };
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		const input = w.find('input[type="number"]');
		expect((input.element as HTMLInputElement).value).toBe('100');
	});

	it('toggles the system message editor', async () => {
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		expect(w.find('textarea').exists()).toBe(false);
		const sysBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('System Message'));
		await sysBtn!.trigger('click');
		expect(w.find('textarea').exists()).toBe(true);
	});

	it('fans a prompt out to the single pane on submit', async () => {
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		const promptEl = w.findComponent('.chat-prompt');
		promptEl.vm.$emit('update:modelValue', 'hello there');
		await w.vm.$nextTick();
		promptEl.vm.$emit('submit');
		await flush();
		expect(sendPlayground).toHaveBeenCalledWith(
			'pg:single',
			expect.objectContaining({ adapterId: 'ad1' }),
			'hello there',
			expect.objectContaining({ maxTokens: 512 })
		);
	});

	it('shows conversation actions and clears all when there are messages', async () => {
		paths['pg:single'] = [{ id: 'u', role: 'user', content: 'hi' }];
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		const clearBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().trim() === 'Clear');
		await clearBtn!.trigger('click');
		expect(clear).toHaveBeenCalled();
	});

	it('stops all panes when the prompt emits stop', async () => {
		loadingKeys.add('pg:single');
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		w.findComponent('.chat-prompt').vm.$emit('stop');
		await w.vm.$nextTick();
		expect(stop).toHaveBeenCalledWith('pg:single');
	});

	it('warns in compare mode when neither side is a published adapter', async () => {
		// no adapters available, only base models -> compare cannot proceed
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockImplementation((url: string) => {
				if (url === '/api/infer/models') return Promise.resolve(models);
				if (url === '/api/adapters/list') return Promise.resolve({ items: [] });
				return Promise.resolve({});
			})
		);
		const w = await mountSuspended(PlaygroundChat, { global });
		await flush();
		const compareBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().trim() === 'Compare');
		await compareBtn!.trigger('click');
		await flush();
		expect(w.text()).toContain('Select at least one published LoRA adapter');
	});
});
