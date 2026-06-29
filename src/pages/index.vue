<template>
	<div class="w-full max-w-7xl mx-auto px-4 sm:px-8 py-8">
		<div class="text-center mb-6">
			<h1
				class="text-3xl md:text-5xl font-bold bg-linear-to-r from-primary via-primary to-info bg-clip-text text-transparent py-1"
			>
				{{ siteName }}
			</h1>
			<p class="text-muted mt-2 max-w-2xl mx-auto">{{ tagline }}</p>
		</div>

		<div class="flex flex-wrap gap-2 justify-center items-center mb-6">
			<UButton
				icon="mdi:refresh"
				color="neutral"
				variant="outline"
				title="Refresh"
				aria-label="Refresh Adapters"
				:loading="refreshing"
				:disabled="refreshing"
				@click="refresh"
			/>
			<UButton
				v-if="authStore.can('canCreate')"
				icon="mdi:plus"
				color="primary"
				variant="outline"
				@click="newAdapterOpen = true"
			>
				New Adapter
			</UButton>
			<UButton
				v-if="!authStore.loggedIn"
				icon="mdi:account-lock"
				color="primary"
				variant="outline"
				@click="openLogin"
			>
				Log In
			</UButton>
			<UButton
				v-if="authStore.loggedIn"
				icon="mdi:view-dashboard"
				color="info"
				variant="outline"
				to="/dashboard"
			>
				Dashboard
			</UButton>
			<UButton
				v-if="authStore.isManager"
				icon="mdi:cog"
				color="neutral"
				variant="outline"
				to="/dashboard/settings"
				title="Settings"
			/>
		</div>

		<AdapterFilters class="mb-6" />

		<UAlert
			v-if="adaptersStore.error && !adaptersStore.loading"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="adaptersStore.error"
			class="mb-4"
		>
			<template #actions>
				<UButton
					size="xs"
					color="error"
					label="Retry"
					@click="refresh"
				/>
			</template>
		</UAlert>

		<AdapterGrid
			:adapters="adaptersStore.items"
			:loading="adaptersStore.loading"
		/>

		<div
			v-if="totalPages > 1"
			class="flex justify-center mt-8"
		>
			<UPagination
				v-model:page="currentPage"
				:total="adaptersStore.total"
				:items-per-page="adaptersStore.pageSize"
				@update:page="onPageChange"
			/>
		</div>

		<AdapterFormModal
			v-if="authStore.can('canCreate')"
			v-model:open="newAdapterOpen"
			mode="create"
			@submit="onAdapterSubmit"
			@close="newAdapterOpen = false"
		/>
	</div>
</template>

<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const adaptersStore = useAdaptersStore();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const config = useRuntimeConfig();

const { page } = storeToRefs(adaptersStore);

const newAdapterOpen = ref(false);

// the global navbar owns the login modal; just set the query marker it watches
function openLogin() {
	router.replace({ query: { ...route.query, login: '1' } });
}

// read initial filters/sort/page from the url query
function applyQueryToStore() {
	const q = route.query;
	adaptersStore.setFilter({
		q: typeof q.q === 'string' ? q.q : '',
		baseModel: typeof q.baseModel === 'string' ? q.baseModel : '',
		modelType: typeof q.modelType === 'string' ? (q.modelType as ModelType) : '',
		tag: typeof q.tag === 'string' ? q.tag : ''
	});
	if (typeof q.sort === 'string') adaptersStore.setSort(q.sort as any);
	const p = Number(q.page);
	if (Number.isFinite(p) && p > 0) adaptersStore.setPage(p);
}

const currentPage = computed({
	get: () => page.value,
	set: (v: number) => adaptersStore.setPage(v)
});

const totalPages = computed(() =>
	Math.max(1, Math.ceil(adaptersStore.total / adaptersStore.pageSize))
);

async function onPageChange(p: number) {
	adaptersStore.setPage(p);
	await adaptersStore.fetchList();
	if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// local spinner so the button only spins on an explicit refresh, not every background fetch
const refreshing = ref(false);
async function refresh() {
	refreshing.value = true;
	try {
		await adaptersStore.fetchList();
	} finally {
		refreshing.value = false;
	}
}

async function onAdapterSubmit() {
	newAdapterOpen.value = false;
	await adaptersStore.fetchList();
}

// keep the grid in sync when filter/sort changes re-fetch
watch(
	() => [
		adaptersStore.filters.q,
		adaptersStore.filters.baseModel,
		adaptersStore.filters.modelType,
		adaptersStore.filters.tag,
		adaptersStore.sort
	],
	() => {
		adaptersStore.fetchList();
	}
);

onMounted(() => {
	if (authStore.loggedIn) settingsStore.fetch().catch(() => {});
});

// ssr-friendly initial load using current filters
applyQueryToStore();
await useAsyncData('adapters:list', () => adaptersStore.fetchList());

const siteName = computed(() => settingsStore.name || config.public.name);
const tagline = computed(() => settingsStore.description || config.public.description);

useSeoMeta({
	title: () => siteName.value,
	description: () => tagline.value,
	ogTitle: () => siteName.value,
	ogDescription: () => tagline.value
});
</script>
