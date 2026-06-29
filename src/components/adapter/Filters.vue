<template>
	<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
		<UFormField
			label="Search"
			class="flex-1 min-w-48"
		>
			<UInput
				v-model="q"
				icon="mdi:magnify"
				placeholder="Search adapters..."
				class="w-full"
				:loading="store.loading"
			/>
		</UFormField>

		<UFormField
			label="Base Model"
			class="min-w-48"
		>
			<USelectMenu
				v-model="baseModel"
				:items="baseModelItems"
				value-key="value"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Model Type"
			class="min-w-36"
		>
			<USelect
				v-model="modelType"
				:items="modelTypeItems"
				value-key="value"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Sort"
			class="min-w-36"
		>
			<USelect
				v-model="sortValue"
				:items="sortItems"
				value-key="value"
				class="w-full"
			/>
		</UFormField>

		<div
			v-if="tag"
			class="flex items-center sm:pb-1.5"
		>
			<UBadge
				color="primary"
				variant="subtle"
				size="lg"
				class="gap-1"
			>
				<UIcon name="mdi:tag" />
				{{ tag }}
				<UButton
					icon="mdi:close"
					size="xs"
					variant="link"
					color="primary"
					class="-mr-1 p-0"
					aria-label="Clear Tag Filter"
					@click="clearTag"
				/>
			</UBadge>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { AdapterSort } from '~/stores/adapters';

// 'all' is the no-filter sentinel; reka SelectItem forbids empty-string values
const ALL = 'all';

const store = useAdaptersStore();
const route = useRoute();
const router = useRouter();

const q = ref(store.filters.q);
const baseModel = ref<string>(store.filters.baseModel || ALL);
const modelType = ref<ModelType | typeof ALL>(store.filters.modelType || ALL);
const sortValue = ref<AdapterSort>(store.sort);
// tag is set by navigating from the tags page; surfaced as a removable chip, not a select
const tag = ref<string>(store.filters.tag || '');

const liveModels = ref<string[]>(DEFAULT_BASE_MODELS.map((m) => m.model));

const baseModelItems = computed(() => [
	{ label: 'All Base Models', value: ALL },
	...liveModels.value.map((m) => ({ label: m.split('/').pop() || m, value: m }))
]);

const modelTypeItems = [
	{ label: 'All Types', value: ALL },
	...MODEL_TYPES.map((t) => ({ label: t, value: t }))
];

const sortItems = [
	{ label: 'Newest', value: 'newest' },
	{ label: 'Downloads', value: 'downloads' },
	{ label: 'Inference', value: 'inference' },
	{ label: 'Name', value: 'name' }
];

// hydrate from the url query on mount
onMounted(() => {
	const query = route.query;
	if (typeof query.q === 'string') q.value = query.q;
	if (typeof query.baseModel === 'string') baseModel.value = query.baseModel;
	if (typeof query.modelType === 'string' && MODEL_TYPES.includes(query.modelType as ModelType)) {
		modelType.value = query.modelType as ModelType;
	}
	if (typeof query.tag === 'string') tag.value = query.tag;
	if (typeof query.sort === 'string') sortValue.value = query.sort as AdapterSort;
	applyFilters();
});

// live lora-capable base models (response is [{model, modelType}]); fall back to the static list
onMounted(async () => {
	try {
		const res = await $fetch<{ model: string }[]>('/api/infer/models');
		const list = Array.isArray(res) ? res.map((m) => m.model).filter(Boolean) : [];
		if (list.length) liveModels.value = list;
	} catch {
		// keep the static fallback
	}
});

function syncUrl() {
	const query: Record<string, string> = {};
	if (q.value) query.q = q.value;
	if (baseModel.value !== ALL) query.baseModel = baseModel.value;
	if (modelType.value !== ALL) query.modelType = modelType.value;
	if (tag.value) query.tag = tag.value;
	if (sortValue.value && sortValue.value !== 'newest') query.sort = sortValue.value;
	router.replace({ query });
}

function applyFilters() {
	store.setFilter({
		q: q.value,
		baseModel: baseModel.value === ALL ? '' : baseModel.value,
		modelType: modelType.value === ALL ? '' : modelType.value,
		tag: tag.value
	});
	store.setSort(sortValue.value);
	store.fetchList();
	syncUrl();
}

function clearTag() {
	tag.value = '';
	applyFilters();
}

// debounce the free-text search; apply selects immediately
let debounce: ReturnType<typeof setTimeout> | null = null;
watch(q, () => {
	if (debounce) clearTimeout(debounce);
	debounce = setTimeout(applyFilters, 350);
});

watch([baseModel, modelType, sortValue], applyFilters);

onBeforeUnmount(() => {
	if (debounce) clearTimeout(debounce);
});
</script>
