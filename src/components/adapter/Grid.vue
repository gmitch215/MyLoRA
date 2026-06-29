<template>
	<div>
		<div
			v-if="loading && !adapters.length"
			class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
		>
			<div
				v-for="n in skeletonCount"
				:key="n"
				class="rounded-lg border border-default overflow-hidden"
			>
				<USkeleton class="aspect-video w-full" />
				<div class="p-4 space-y-3">
					<USkeleton class="h-5 w-3/4" />
					<div class="flex gap-1.5">
						<USkeleton class="h-5 w-16" />
						<USkeleton class="h-5 w-14" />
					</div>
					<USkeleton class="h-4 w-1/2" />
				</div>
			</div>
		</div>

		<div
			v-else-if="adapters.length"
			class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
		>
			<AdapterCard
				v-for="adapter in adapters"
				:key="adapter.id"
				:adapter="adapter"
			/>
		</div>

		<div
			v-else
			class="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted"
		>
			<UIcon
				name="mdi:cube-off-outline"
				class="size-12 text-dimmed"
			/>
			<p class="text-sm">No adapters yet.</p>
		</div>
	</div>
</template>

<script setup lang="ts">
withDefaults(
	defineProps<{
		adapters: Adapter[];
		loading?: boolean;
	}>(),
	{ loading: false }
);

const skeletonCount = 8;
</script>
