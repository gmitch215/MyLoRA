export default defineCachedEventHandler(
	async () => {
		return DEFAULT_BASE_MODELS.map((m) => ({
			model: m.model,
			modelType: m.modelType,
			contextWindow: contextWindowFor(m.model)
		}));
	},
	{ maxAge: 60 * 60, name: 'infer-models', getKey: () => 'base-models' }
);
