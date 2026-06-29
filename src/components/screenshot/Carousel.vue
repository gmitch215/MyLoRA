<template>
	<UCarousel
		v-if="screenshots.length"
		v-slot="{ item }"
		:items="screenshots"
		:ui="{ item: 'basis-full' }"
		arrows
		dots
		class="w-full"
	>
		<div class="aspect-video w-full overflow-hidden rounded-lg bg-elevated/60">
			<NuxtImg
				:src="screenshotUrl(item)"
				:alt="`screenshot ${item.split('/').pop()}`"
				class="h-full w-full object-contain"
				loading="lazy"
			/>
		</div>
	</UCarousel>
</template>

<script setup lang="ts">
defineProps<{ screenshots: string[] }>();

// screenshots are r2 pathnames; served from the /files blob route
function screenshotUrl(pathname: string) {
	if (/^(https?:)?\//.test(pathname)) return pathname;
	return `/files/${pathname}`;
}
</script>
