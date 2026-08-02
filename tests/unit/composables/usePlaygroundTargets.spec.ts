import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaygroundTargets } from '~/composables/usePlaygroundTargets';

const ADAPTER = {
	id: 'ad1',
	name: 'Snark',
	slug: 'snark',
	baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
	modelType: 'mistral',
	status: 'published'
};
const MIGRATED = { ...ADAPTER, id: 'ad2', name: 'Imported', status: 'migrated' };
const DRAFT = { ...ADAPTER, id: 'ad3', name: 'Draft', status: 'draft' };

const MODELS = [
	{
		model: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
		modelType: 'mistral',
		contextWindow: 32768
	},
	{ model: '@cf/meta-llama/llama-2-7b-chat-hf-lora', modelType: 'llama', contextWindow: 4096 }
];

function stubFetch(items: unknown[] = [ADAPTER, MIGRATED, DRAFT], models: unknown = MODELS) {
	const fn = vi.fn().mockImplementation(async (url: string) => {
		if (url === '/api/infer/models') return models;
		if (url === '/api/adapters/list') return { items };
		return {};
	});
	vi.stubGlobal('$fetch', fn);
	return fn;
}

beforeEach(() => {
	vi.clearAllMocks();
	// useState is app-scoped; clear it between cases so `loaded` does not leak
	const t = usePlaygroundTargets();
	t.models.value = [];
	t.adapters.value = [];
	t.loaded.value = false;
});

describe('usePlaygroundTargets', () => {
	it('loads models and keeps only testable adapters', async () => {
		stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.models.value).toHaveLength(2);
		// published + migrated are testable; draft is not
		expect(t.adapters.value.map((a) => a.id)).toEqual(['ad1', 'ad2']);
		expect(t.loaded.value).toBe(true);
	});

	it('fetches once and shares the result across callers', async () => {
		const fn = stubFetch();
		const a = usePlaygroundTargets();
		const b = usePlaygroundTargets();
		await Promise.all([a.load(), b.load()]);
		// two endpoints, one round each; the second caller reuses the in-flight promise
		expect(fn).toHaveBeenCalledTimes(2);
		expect(b.adapters.value).toHaveLength(2);
	});

	it('does not refetch once loaded', async () => {
		const fn = stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		await t.load();
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('degrades to empty lists when both endpoints fail', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('offline')));
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.models.value).toEqual([]);
		expect(t.adapters.value).toEqual([]);
		expect(t.options.value).toEqual([]);
	});

	it('tolerates a non-array models payload', async () => {
		stubFetch([ADAPTER], { nope: true });
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.models.value).toEqual([]);
	});

	it('builds adapter options before base options, each showing the short model name', async () => {
		stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.options.value.map((o) => o.value)).toEqual([
			'adapter:ad1',
			'adapter:ad2',
			'base:@cf/mistral/mistral-7b-instruct-v0.2-lora',
			'base:@cf/meta-llama/llama-2-7b-chat-hf-lora'
		]);
		expect(t.options.value[0]!.label).toBe('LoRA: Snark (mistral-7b-instruct-v0.2-lora)');
		expect(t.options.value[2]!.label).toBe('Base: mistral-7b-instruct-v0.2-lora');
		// the separator stays ascii
		expect(/^[\x20-\x7e]*$/.test(t.options.value[0]!.label)).toBe(true);
	});

	it('decodes both option encodings and rejects anything else', async () => {
		stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.targetOf('adapter:ad1')).toEqual({ adapterId: 'ad1' });
		expect(t.targetOf('base:@cf/x')).toEqual({ baseModel: '@cf/x' });
		expect(t.targetOf('')).toBeNull();
		expect(t.targetOf('nonsense')).toBeNull();
		expect(t.targetIsAdapter('adapter:ad1')).toBe(true);
		expect(t.targetIsAdapter('base:@cf/x')).toBe(false);
	});

	it('resolves the base model behind either encoding', async () => {
		stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.modelOf('adapter:ad1')).toBe(ADAPTER.baseModel);
		expect(t.modelOf('base:@cf/meta-llama/llama-2-7b-chat-hf-lora')).toBe(
			'@cf/meta-llama/llama-2-7b-chat-hf-lora'
		);
		expect(t.modelOf('adapter:missing')).toBe('');
		expect(t.modelOf('junk')).toBe('');
	});

	it('reports the context window of the resolved base model', async () => {
		stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.contextFor('adapter:ad1')).toBe(32768);
		expect(t.contextFor('base:@cf/meta-llama/llama-2-7b-chat-hf-lora')).toBe(4096);
		// unknown model falls back to the shared default
		expect(t.contextFor('base:@cf/unknown')).toBe(DEFAULT_CONTEXT_WINDOW);
	});

	it('labels a known value and echoes an unknown one', async () => {
		stubFetch();
		const t = usePlaygroundTargets();
		await t.load();
		expect(t.labelFor('adapter:ad1')).toContain('Snark');
		expect(t.labelFor('adapter:gone')).toBe('adapter:gone');
	});
});
