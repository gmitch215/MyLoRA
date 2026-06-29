<template>
	<UContextMenu :items="buildMenu(adapter)">
		<UCard
			class="group h-full transition-shadow hover:shadow-md"
			:ui="{ body: 'p-0 sm:p-0', root: 'overflow-hidden' }"
		>
			<NuxtLink
				:to="`/adapters/${adapter.slug}`"
				class="block"
			>
				<!-- thumbnail -->
				<div class="relative aspect-video w-full overflow-hidden bg-elevated/60">
					<NuxtImg
						v-if="thumbnail"
						:src="thumbnail"
						:alt="adapter.name"
						class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
						loading="lazy"
					/>
					<div
						v-else
						class="flex h-full w-full items-center justify-center"
					>
						<UIcon
							v-if="adapter.iconName"
							:name="adapter.iconName"
							class="size-16"
							:style="{ color: resolveColorVar(adapter.iconColor, 'var(--ui-text-toned)') }"
						/>
						<UIcon
							v-else
							name="mdi:cube-outline"
							class="size-10"
							:style="{ color: resolveColorVar(adapter.iconColor, 'var(--ui-text-dimmed)') }"
						/>
					</div>
					<UBadge
						v-if="adapter.status !== 'published'"
						:color="statusColor as any"
						variant="solid"
						size="sm"
						class="absolute top-2 right-2 capitalize"
					>
						{{ adapter.status }}
					</UBadge>
				</div>

				<div class="p-4 space-y-3">
					<div class="flex items-start justify-between gap-2">
						<h3 class="font-semibold text-highlighted leading-tight line-clamp-2">
							{{ adapter.name }}
						</h3>
					</div>

					<div class="flex flex-wrap items-center gap-1.5">
						<AdapterBaseBadge :model="adapter.baseModel" />
						<AdapterModelBadge :type="adapter.modelType" />
						<UBadge
							color="neutral"
							variant="soft"
							size="sm"
						>
							rank {{ adapter.rank }}
						</UBadge>
					</div>

					<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
						<span class="inline-flex items-center gap-1">
							<UIcon
								name="mdi:weight"
								class="size-4"
							/>
							{{ formatBytes(adapter.weightsBytes) }}
						</span>
						<span class="inline-flex items-center gap-1">
							<UIcon
								name="mdi:download"
								class="size-4 text-info"
							/>
							{{ adapter.downloadCount.toLocaleString() }}
						</span>
						<span class="inline-flex items-center gap-1">
							<UIcon
								name="mdi:flask"
								class="size-4 text-warning"
							/>
							{{ adapter.inferenceCount.toLocaleString() }}
						</span>
					</div>

					<div
						v-if="adapter.tags.length"
						class="flex flex-wrap gap-1"
					>
						<UBadge
							v-for="tag in adapter.tags.slice(0, 4)"
							:key="tag"
							color="neutral"
							variant="outline"
							size="sm"
						>
							{{ tag }}
						</UBadge>
						<UBadge
							v-if="adapter.tags.length > 4"
							color="neutral"
							variant="outline"
							size="sm"
						>
							+{{ adapter.tags.length - 4 }}
						</UBadge>
					</div>

					<div class="flex items-center justify-between gap-2 border-t border-default/60 pt-2">
						<div
							v-if="adapter.author"
							class="flex min-w-0 items-center gap-2"
						>
							<Avatar
								:user="adapter.author"
								size="xs"
							/>
							<span class="truncate text-xs text-muted">{{ adapter.author.displayName }}</span>
						</div>
						<RelativeTime
							:date="adapter.created_at"
							class="shrink-0 text-xs"
						/>
					</div>
				</div>
			</NuxtLink>
		</UCard>
	</UContextMenu>
</template>

<script setup lang="ts">
const props = defineProps<{ adapter: Adapter }>();

// right-click menu; edit/delete deep-link to the detail page (the card has no modal of its own)
const buildMenu = useAdapterMenu();

// screenshots are r2 pathnames served from the /files blob route
const thumbnail = computed(() => {
	const first = props.adapter.screenshots?.[0];
	return first ? `/files/${first}` : null;
});

const STATUS_COLORS: Record<AdapterStatus, string> = {
	draft: 'neutral',
	listed: 'info',
	pushing: 'warning',
	published: 'success',
	failed: 'error',
	archived: 'neutral',
	migrated: 'secondary'
};

const statusColor = computed(() => STATUS_COLORS[props.adapter.status] ?? 'neutral');
</script>
