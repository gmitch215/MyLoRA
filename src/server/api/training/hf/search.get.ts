// proxy the PUBLIC keyless huggingface datasets search so the PEFT tab can offer a dataset picker
// without CORS issues or uploading any token. mocked in the test env.
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	const q = String(getQuery(event).q || '').trim();
	if (!q) return { results: [] };

	if (isMockSsh()) {
		return {
			results: [
				{ id: `${q}/mock-dataset`, gated: false, downloads: 1234, likes: 5, private: false },
				{ id: `mock/${q}-corpus`, gated: false, downloads: 56, likes: 1, private: false }
			]
		};
	}

	try {
		const res = await $fetch<
			{
				id: string;
				gated?: boolean | string;
				downloads?: number;
				likes?: number;
				private?: boolean;
			}[]
		>('https://huggingface.co/api/datasets', {
			query: { search: q, limit: 20 },
			timeout: 8000
		});
		return {
			results: (res || []).map((d) => ({
				id: d.id,
				gated: !!d.gated && d.gated !== 'false',
				downloads: d.downloads ?? 0,
				likes: d.likes ?? 0,
				private: !!d.private
			}))
		};
	} catch {
		return { results: [], error: 'HuggingFace search is unavailable right now' };
	}
});
