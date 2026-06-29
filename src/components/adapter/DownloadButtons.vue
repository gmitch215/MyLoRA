<template>
	<div class="flex flex-col items-center gap-y-4 gap-x-2 sm:flex-row flex-wrap">
		<UButton
			:to="`/api/adapters/${adapter.id}/download/config`"
			external
			download
			icon="mdi:code-json"
			color="secondary"
			variant="outline"
			:disabled="!hasConfig"
			class="justify-center"
		>
			Config
			<span class="text-xs text-muted">({{ formatBytes(adapter.configBytes) }})</span>
		</UButton>
		<UButton
			:to="`/api/adapters/${adapter.id}/download/weights`"
			external
			download
			icon="mdi:weight"
			color="primary"
			variant="solid"
			:disabled="!hasWeights"
			class="justify-center"
		>
			Weights
			<span class="text-xs opacity-80">({{ formatBytes(adapter.weightsBytes) }})</span>
		</UButton>
		<div class="flex items-center gap-1 text-xs text-muted">
			<UIcon
				name="mdi:download"
				class="size-5"
			/>
			{{ adapter.downloadCount.toLocaleString() }} downloads
		</div>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ adapter: Adapter }>();

const hasConfig = computed(() => props.adapter.configBytes > 0);
const hasWeights = computed(() => props.adapter.weightsBytes > 0);
</script>
