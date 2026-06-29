<template>
	<UTooltip :text="model">
		<UBadge
			color="neutral"
			variant="outline"
			size="sm"
			class="font-mono"
		>
			{{ short }}
		</UBadge>
	</UTooltip>
</template>

<script setup lang="ts">
const props = defineProps<{ model: string }>();

// last path segment of the full model id (e.g. @cf/google/gemma-2b-it-lora -> gemma-2b-it-lora)
const short = computed(() => {
	const parts = props.model.split('/').filter(Boolean);
	return parts[parts.length - 1] || props.model;
});
</script>
