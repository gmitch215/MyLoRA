<template>
	<UBadge
		:color="color as any"
		variant="subtle"
		size="sm"
		class="capitalize"
	>
		{{ type }}
	</UBadge>
</template>

<script setup lang="ts">
const props = defineProps<{ type: ModelType }>();

// one color per known model family
const COLORS: Record<ModelType, string> = {
	mistral: 'warning',
	gemma: 'info',
	llama: 'secondary',
	qwen: 'success'
};

const color = computed(() => COLORS[props.type] ?? 'neutral');
</script>
