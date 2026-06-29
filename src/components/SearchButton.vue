<template>
	<UButton
		icon="mdi:magnify"
		variant="subtle"
		color="neutral"
		title="Search (Cmd K)"
		aria-label="Open command palette"
		@click="show()"
	>
		<span class="hidden text-muted sm:inline">Search</span>
		<template #trailing>
			<div class="hidden items-center gap-0.5 sm:flex">
				<UKbd value="meta" />
				<UKbd value="k" />
			</div>
		</template>
	</UButton>
</template>

<script setup lang="ts">
const { show } = useCommandPalette();
</script>
