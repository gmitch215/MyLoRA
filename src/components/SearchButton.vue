<template>
	<UButton
		icon="mdi:magnify"
		variant="subtle"
		color="neutral"
		:square="collapsed"
		title="Search (Cmd K)"
		aria-label="Open command palette"
		@click="show()"
	>
		<span
			v-if="!collapsed"
			class="hidden text-muted sm:inline"
			>Search</span
		>
		<template
			v-if="!collapsed"
			#trailing
		>
			<div class="hidden items-center gap-0.5 sm:flex">
				<UKbd value="meta" />
				<UKbd value="k" />
			</div>
		</template>
	</UButton>
</template>

<script setup lang="ts">
// collapsed renders an icon-only square button (used in the collapsed dashboard sidebar)
defineProps<{ collapsed?: boolean }>();
const { show } = useCommandPalette();
</script>
