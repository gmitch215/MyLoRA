export type PlaygroundModel = { model: string; modelType: string; contextWindow?: number };

/** an option value is encoded as `adapter:<id>` or `base:<model>` */
export type PlaygroundTarget = { adapterId?: string; baseModel?: string };

function shortModel(model: string): string {
	return model.split('/').pop() || model;
}

// shared across the playground panels so the compare/versus panes do not each refetch the catalog
let inflight: Promise<void> | null = null;

export function usePlaygroundTargets() {
	const models = useState<PlaygroundModel[]>('pg:models', () => []);
	const adapters = useState<Adapter[]>('pg:adapters', () => []);
	const loaded = useState('pg:targets-loaded', () => false);

	async function load() {
		if (loaded.value) return;
		if (inflight) return inflight;
		inflight = (async () => {
			const [m, a] = await Promise.all([
				$fetch<PlaygroundModel[]>('/api/infer/models').catch(() => []),
				$fetch<{ items: Adapter[] }>('/api/adapters/list', {
					query: { pageSize: 100, sort: 'newest' }
				}).catch(() => ({ items: [] as Adapter[] }))
			]);
			models.value = Array.isArray(m) ? m : [];
			// published + migrated adapters are testable in the playground
			adapters.value = (a.items ?? []).filter((x) => isTestable(x.status));
			loaded.value = true;
		})().finally(() => {
			inflight = null;
		});
		return inflight;
	}

	const options = computed(() => [
		...adapters.value.map((a) => ({
			// include the base model so it's clear what each lora runs on
			label: `LoRA: ${a.name} (${shortModel(a.baseModel)})`,
			value: `adapter:${a.id}`
		})),
		...models.value.map((m) => ({
			label: `Base: ${shortModel(m.model)}`,
			value: `base:${m.model}`
		}))
	]);

	function targetIsAdapter(value: string): boolean {
		return value.startsWith('adapter:');
	}

	function targetOf(value: string): PlaygroundTarget | null {
		if (value.startsWith('adapter:')) return { adapterId: value.slice('adapter:'.length) };
		if (value.startsWith('base:')) return { baseModel: value.slice('base:'.length) };
		return null;
	}

	// the base model behind a target value (adapter -> its base; base -> itself)
	function modelOf(value: string): string {
		if (value.startsWith('adapter:')) {
			const id = value.slice('adapter:'.length);
			return adapters.value.find((a) => a.id === id)?.baseModel ?? '';
		}
		if (value.startsWith('base:')) return value.slice('base:'.length);
		return '';
	}

	function contextFor(value: string): number {
		return contextWindowFor(modelOf(value));
	}

	function labelFor(value: string): string {
		return options.value.find((o) => o.value === value)?.label ?? value;
	}

	return {
		models,
		adapters,
		loaded,
		load,
		options,
		targetIsAdapter,
		targetOf,
		modelOf,
		contextFor,
		labelFor
	};
}
