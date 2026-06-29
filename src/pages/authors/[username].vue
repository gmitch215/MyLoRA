<template>
	<div class="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8">
		<header class="flex flex-col sm:flex-row items-center sm:items-start gap-6 mb-10">
			<Avatar
				:pathname="author?.avatarPathname"
				:display-name="author?.displayName"
				size="xl"
			/>
			<div class="text-center sm:text-left flex-1">
				<h1 class="text-3xl font-bold">{{ author?.displayName }}</h1>
				<p class="text-muted text-sm mt-1">
					@{{ author?.username }}
					<UBadge
						:color="roleColor"
						variant="soft"
						size="sm"
						class="ml-2"
					>
						{{ author?.role }}
					</UBadge>
				</p>
				<p
					v-if="author?.bio"
					class="mt-3 whitespace-pre-line text-muted"
				>
					{{ author.bio }}
				</p>
			</div>
		</header>

		<section>
			<h2 class="text-xl font-semibold mb-4">Adapters ({{ adapters.length }})</h2>
			<div
				v-if="adapters.length === 0"
				class="text-center text-muted py-12 border border-default border-dashed rounded-lg"
			>
				No adapters yet.
			</div>
			<AdapterGrid
				v-else
				:adapters="adapters"
			/>
		</section>
	</div>
</template>

<script setup lang="ts">
const route = useRoute();
const settingsStore = useSettingsStore();
const config = useRuntimeConfig();

const username = computed(() => String(route.params.username || '').toLowerCase());

const { data, error } = await useAsyncData(
	() => `author:${username.value}`,
	() => $fetch<{ author: PublicUser; adapters: Adapter[] }>(`/api/users/${username.value}`)
);

if (error.value) {
	throw createError({
		statusCode: 404,
		statusMessage: 'Author Not Found',
		message: 'No author by that username.',
		fatal: false
	});
}

const author = computed(() => data.value?.author ?? null);
const adapters = computed(() => data.value?.adapters ?? []);

const roleColor = computed(() => {
	switch (author.value?.role) {
		case 'developer':
			return 'primary';
		case 'manager':
			return 'success';
		case 'administrator':
			return 'error';
		default:
			return 'neutral';
	}
});

const siteName = computed(() => settingsStore.name || config.public.name);
useSeoMeta({
	title: () => `${author.value?.displayName ?? username.value} | ${siteName.value}`,
	description: () =>
		author.value?.bio || `LoRA adapters by ${author.value?.displayName ?? username.value}`,
	ogTitle: () => `${author.value?.displayName ?? username.value} | ${siteName.value}`,
	ogDescription: () =>
		author.value?.bio || `LoRA adapters by ${author.value?.displayName ?? username.value}`
});
</script>
