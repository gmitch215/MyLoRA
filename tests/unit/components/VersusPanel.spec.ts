import { mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VersusPanel from '~/components/ai/VersusPanel.vue';

const ADAPTER = {
	id: 'ad1',
	name: 'Snark',
	slug: 'snark',
	baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
	modelType: 'mistral',
	status: 'published',
	tags: [],
	examples: [],
	screenshots: [],
	rank: 8,
	configBytes: 1,
	weightsBytes: 1,
	visibility: 'public',
	cfPublic: false,
	downloadCount: 0,
	inferenceCount: 0,
	created_at: new Date(0),
	updated_at: new Date(0)
};

const MODELS = [
	{
		model: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
		modelType: 'mistral',
		contextWindow: 32768
	},
	{ model: '@cf/google/gemma-2b-it-lora', modelType: 'gemma', contextWindow: 8192 }
];

const runVersus = vi.fn().mockResolvedValue(undefined);
const stopVersus = vi.fn();
const clearVersus = vi.fn();
const hydrateVersus = vi.fn();
const versus = {
	topic: '',
	labels: { a: '', b: '' },
	messages: [] as { id: string; side: 'a' | 'b'; content: string }[],
	running: false,
	turn: 0,
	total: 0,
	error: null as string | null,
	retryAfter: null as number | null,
	stopped: null as string | null
};

const limits = {
	maxOutputTokens: 512,
	maxSystemPromptChars: 2000,
	versusMinMessages: 1,
	versusMaxMessages: 10
};

vi.mock('#imports', async (importOriginal) => (await importOriginal()) as object);

mockNuxtImport('useInferenceStore', () => () => ({
	versus,
	runVersus,
	stopVersus,
	clearVersus,
	hydrateVersus
}));
mockNuxtImport('useSettingsStore', () => () => ({ limits }));
mockNuxtImport('storeToRefs', () => (store: any) => ({ limits: ref(store.limits) }));

const stubs = { UTooltip: { template: '<div><slot /></div>' } };

function stubFetch() {
	vi.stubGlobal(
		'$fetch',
		vi.fn().mockImplementation(async (url: string) => {
			if (url === '/api/infer/models') return MODELS;
			if (url === '/api/adapters/list') return { items: [ADAPTER] };
			return {};
		})
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	Object.assign(versus, {
		topic: '',
		labels: { a: '', b: '' },
		messages: [],
		running: false,
		turn: 0,
		total: 0,
		error: null,
		retryAfter: null,
		stopped: null
	});
	Object.assign(limits, {
		maxOutputTokens: 512,
		maxSystemPromptChars: 2000,
		versusMinMessages: 1,
		versusMaxMessages: 10
	});
	stubFetch();
});

const mount = () => mountSuspended(VersusPanel, { global: { stubs } });

describe('VersusPanel', () => {
	it('hydrates a saved match and loads the target catalog on mount', async () => {
		await mount();
		expect(hydrateVersus).toHaveBeenCalled();
	});

	it('bounds the messages-each control by the configured limits', async () => {
		const w = await mount();
		const input = w.findAll('input[type="number"]')[0]!;
		expect(input.attributes('min')).toBe('1');
		expect(input.attributes('max')).toBe('10');
		expect((input.element as HTMLInputElement).value).toBe('5');
	});

	it('reflects an admin-narrowed range and pulls the default inside it', async () => {
		limits.versusMinMessages = 7;
		limits.versusMaxMessages = 9;
		const w = await mount();
		const input = w.findAll('input[type="number"]')[0]!;
		expect(input.attributes('min')).toBe('7');
		expect(input.attributes('max')).toBe('9');
		expect((input.element as HTMLInputElement).value).toBe('7');
	});

	it('pre-fills both personas from the default debate preset', async () => {
		const w = await mount();
		const areas = w.findAll('textarea');
		const a = areas.find((t) => t.attributes('aria-label') === 'Agent A Persona');
		const b = areas.find((t) => t.attributes('aria-label') === 'Agent B Persona');
		expect((a!.element as HTMLTextAreaElement).value).toContain('Argue FOR');
		expect((b!.element as HTMLTextAreaElement).value).toContain('Argue AGAINST');
	});

	it('hides the persona fields entirely when system prompts are disabled', async () => {
		limits.maxSystemPromptChars = 0;
		const w = await mount();
		expect(w.find('textarea[aria-label="Agent A Persona"]').exists()).toBe(false);
		expect(w.find('textarea[aria-label="Agent B Persona"]').exists()).toBe(false);
	});

	it('keeps Start disabled until a topic is entered', async () => {
		const w = await mount();
		const start = w
			.findAllComponents({ name: 'UButton' })
			.find((b: any) => b.text().includes('Start Match'));
		expect(start!.props('disabled')).toBe(true);
	});

	it('starts a run with both targets, personas and the clamped message count', async () => {
		const w = await mount();
		await w.find('textarea[placeholder="What should they talk about?"]').setValue('tabs vs spaces');
		const start = w
			.findAllComponents({ name: 'UButton' })
			.find((b: any) => b.text().includes('Start Match'));
		await start!.trigger('click');

		expect(runVersus).toHaveBeenCalledTimes(1);
		const cfg = runVersus.mock.calls[0]![0];
		expect(cfg.topic).toBe('tabs vs spaces');
		expect(cfg.first).toBe('a');
		expect(cfg.perAgent).toBe(5);
		expect(cfg.maxSystemChars).toBe(2000);
		// defaults pair the first adapter against its own base model
		expect(cfg.a.target).toEqual({ adapterId: 'ad1' });
		expect(cfg.b.target).toEqual({ baseModel: ADAPTER.baseModel });
		expect(cfg.a.persona).toContain('Argue FOR');
		expect(cfg.b.persona).toContain('Argue AGAINST');
	});

	it('swaps the first speaker', async () => {
		const w = await mount();
		const speakFirst = w
			.findAllComponents({ name: 'UButton' })
			.find((b: any) => b.text().includes('Speak First'));
		await speakFirst!.trigger('click');
		await w.find('textarea[placeholder="What should they talk about?"]').setValue('go');
		const start = w
			.findAllComponents({ name: 'UButton' })
			.find((b: any) => b.text().includes('Start Match'));
		await start!.trigger('click');
		expect(runVersus.mock.calls[0]![0].first).toBe('b');
	});

	it('swaps Start for Stop while a run is in flight', async () => {
		versus.running = true;
		const w = await mount();
		const labels = w.findAllComponents({ name: 'UButton' }).map((b: any) => b.text());
		expect(labels.some((t: string) => t.includes('Stop'))).toBe(true);
		expect(labels.some((t: string) => t.includes('Start Match'))).toBe(false);
	});

	it('reports progress through the run', async () => {
		versus.running = true;
		versus.turn = 3;
		versus.total = 10;
		const w = await mount();
		expect(w.text()).toContain('Message 3 of 10');
	});

	it('explains a rate-limited stop and says the transcript is kept', async () => {
		versus.stopped = 'limit';
		versus.error = 'Hourly prompt limit reached';
		versus.retryAfter = 900;
		versus.messages = [{ id: '1', side: 'a', content: 'partial' }];
		const w = await mount();
		expect(w.text()).toContain('Match Stopped by the Rate Limit');
		expect(w.text()).toContain('Hourly prompt limit reached');
		expect(w.text()).toContain('15 minute');
		expect(w.text()).toContain('kept');
	});

	it('acknowledges a user stop without an error style', async () => {
		versus.stopped = 'user';
		versus.messages = [{ id: '1', side: 'a', content: 'partial' }];
		const w = await mount();
		expect(w.text()).toContain('Match Stopped');
		expect(w.text()).not.toContain('Match Failed');
	});

	it('surfaces a hard failure', async () => {
		versus.stopped = 'error';
		versus.error = 'upstream boom';
		const w = await mount();
		expect(w.text()).toContain('Match Failed');
		expect(w.text()).toContain('upstream boom');
	});

	it('exposes transcript controls only once there are messages', async () => {
		const empty = await mount();
		expect(empty.find('button[aria-label="Copy Transcript"]').exists()).toBe(false);

		versus.messages = [{ id: '1', side: 'a', content: 'hi' }];
		const filled = await mount();
		expect(filled.find('button[aria-label="Copy Transcript"]').exists()).toBe(true);
		expect(filled.find('button[aria-label="Download Transcript"]').exists()).toBe(true);
	});

	it('meters the context against the smaller of the two windows', async () => {
		versus.topic = 'topic';
		versus.messages = [{ id: '1', side: 'a', content: 'x'.repeat(40) }];
		const w = await mount();
		// both defaults sit on the mistral base (32768)
		expect(w.text()).toContain('32,768');
	});
});
