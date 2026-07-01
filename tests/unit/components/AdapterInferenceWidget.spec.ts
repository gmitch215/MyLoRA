import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import InferenceWidget from '~/components/adapter/InferenceWidget.vue';

// inference store: a single session keyed by adapter id, plus action spies
const session = reactive<any>({
	nodes: {},
	roots: [],
	selection: {},
	loading: false,
	error: null,
	rateLimited: false,
	retryAfter: null
});
let path: any[] = [];
const clear = vi.fn();
const stop = vi.fn();
const sendWidget = vi.fn().mockResolvedValue(undefined);
const editWidget = vi.fn().mockResolvedValue(undefined);
const branch = vi.fn();

const inference = {
	sessions: { a1: session },
	pathOf: () => path,
	clear,
	stop,
	sendWidget,
	editWidget,
	branch
};
mockNuxtImport('useInferenceStore', () => () => inference);

// settings + auth exposed through storeToRefs; pass refs straight through
const access = ref<any>({ testerAccess: 'public' });
const limits = ref<any>({ maxSystemPromptChars: 500 });
const loggedIn = ref(true);
mockNuxtImport('useSettingsStore', () => () => ({ access, limits }));
mockNuxtImport('useAuthStore', () => () => ({ loggedIn }));
mockNuxtImport('storeToRefs', () => (s: any) => s);

const copy = vi.fn();
const download = vi.fn();
mockNuxtImport('useChatExport', () => () => ({ copy, download, copied: ref(false) }));

const global = {
	stubs: {
		UTooltip: { template: '<div><slot /></div>' },
		UChatPrompt: { template: '<div class="chat-prompt"><slot /></div>' },
		UChatPromptSubmit: { template: '<button class="submit" />' },
		UBanner: { props: ['title'], template: '<div class="banner">{{ title }}</div>' }
	}
};

function adapter(extra: Record<string, unknown> = {}) {
	return {
		id: 'a1',
		slug: 'my-lora',
		name: 'My LoRA',
		baseModel: '@cf/google/gemma-2b',
		status: 'published',
		...extra
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	path = [];
	session.loading = false;
	session.error = null;
	session.rateLimited = false;
	session.retryAfter = null;
	access.value = { testerAccess: 'public' };
	limits.value = { maxSystemPromptChars: 500 };
	loggedIn.value = true;
});

describe('AdapterInferenceWidget', () => {
	it('shows a not-testable alert for an unpublished adapter', async () => {
		const w = await mountSuspended(InferenceWidget, {
			global,
			props: { adapter: adapter({ status: 'draft' }) }
		});
		expect(w.text()).toContain('Not Yet Testable');
	});

	it('shows the full badge for a logged-in user', async () => {
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.text()).toContain('Full');
	});

	it('shows the limited badge for a logged-out user', async () => {
		loggedIn.value = false;
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.text()).toContain('Limited');
	});

	it('gates behind login when tester access requires it', async () => {
		access.value = { testerAccess: 'login' };
		loggedIn.value = false;
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.text()).toContain('Log In to Test');
	});

	it('renders the chat thread and prompt when testable and allowed', async () => {
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.findComponent({ name: 'AiChatThread' }).exists()).toBe(true);
		expect(w.find('.chat-prompt').exists()).toBe(true);
	});

	it('shows conversation actions and clears on click when there are messages', async () => {
		path = [{ id: 'u1', role: 'user', content: 'hi' }];
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		const clearBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.attributes('aria-label') === 'Clear Conversation');
		await clearBtn!.trigger('click');
		expect(clear).toHaveBeenCalledWith('a1');
	});

	it('copies and downloads the conversation', async () => {
		path = [{ id: 'u1', role: 'user', content: 'hi' }];
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		const btns = w.findAllComponents({ name: 'UButton' });
		await btns.find((b) => b.attributes('aria-label') === 'Copy Conversation')!.trigger('click');
		await btns
			.find((b) => b.attributes('aria-label') === 'Download Conversation')!
			.trigger('click');
		expect(copy).toHaveBeenCalled();
		expect(download).toHaveBeenCalled();
	});

	it('shows the context meter once there are messages', async () => {
		path = [{ id: 'u1', role: 'user', content: 'hello world' }];
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.findComponent({ name: 'AiContextMeter' }).exists()).toBe(true);
	});

	it('surfaces a session error', async () => {
		session.error = 'model exploded';
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.text()).toContain('model exploded');
	});

	it('shows the rate limit banner when rate limited', async () => {
		session.rateLimited = true;
		session.retryAfter = 30;
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.find('.banner').text()).toContain('Rate limit reached');
	});

	it('toggles the system message editor when allowed', async () => {
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		const sysBtn = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('System Message'));
		expect(w.find('textarea').exists()).toBe(false);
		await sysBtn!.trigger('click');
		expect(w.find('textarea').exists()).toBe(true);
	});

	it('hides the system message editor when disabled by limits', async () => {
		limits.value = { maxSystemPromptChars: 0 };
		const w = await mountSuspended(InferenceWidget, { global, props: { adapter: adapter() } });
		expect(w.text()).not.toContain('System Message');
	});
});
