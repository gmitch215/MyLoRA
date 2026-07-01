<template>
	<div class="w-full max-w-3xl mx-auto px-4 sm:px-8 py-10">
		<div class="text-center mb-8">
			<UIcon
				name="mdi:tag-multiple"
				class="size-10 text-primary mb-2"
			/>
			<h1 class="text-3xl font-bold">Browse by Tag</h1>
			<p class="text-muted mt-1">Jump to adapters sharing a tag.</p>
		</div>

		<div
			v-if="pending"
			class="flex justify-center py-12"
		>
			<AppSpinner
				size="lg"
				class="text-muted"
			/>
		</div>

		<div
			v-else-if="tags.length === 0"
			class="text-center text-muted py-12"
		>
			No tags yet.
		</div>

		<div
			v-else
			class="rounded-xl border border-default bg-elevated/30 p-6"
		>
			<p class="mb-4 text-center text-xs text-muted">
				{{ tags.length }} {{ tags.length === 1 ? 'tag' : 'tags' }} across the registry
			</p>
			<div class="flex flex-wrap justify-center gap-2">
				<UButton
					v-for="(t, i) in tags"
					:key="t.tag"
					:to="`/?tag=${encodeURIComponent(t.tag)}`"
					:color="chipColors[i % chipColors.length]"
					variant="soft"
					size="sm"
				>
					{{ t.tag }}
					<UBadge
						color="neutral"
						variant="solid"
						size="sm"
						class="ml-1"
					>
						{{ t.count }}
					</UBadge>
				</UButton>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
const settingsStore = useSettingsStore();
const config = useRuntimeConfig();

// cycle tag chips through a few accent colors for a livelier cloud
const chipColors = ['primary', 'info', 'success', 'warning', 'secondary'] as const;

type ListResponse = { items: Adapter[]; total: number; page: number; pageSize: number };

// pull a large page and aggregate tags client-side
const { data, pending } = await useAsyncData('tags:all', () =>
	$fetch<ListResponse>('/api/adapters/list', { query: { pageSize: 60, sort: 'newest' } })
);

const tags = computed(() => {
	const counts = new Map<string, number>();
	for (const a of data.value?.items ?? []) {
		for (const tag of a.tags ?? []) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return Array.from(counts.entries())
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
});

const siteName = computed(() => settingsStore.name || config.public.name);
useSeoMeta({
	title: () => `Tags - ${siteName.value}`,
	description: () => `Browse LoRA adapters by tag on ${siteName.value}.`
});
</script>
