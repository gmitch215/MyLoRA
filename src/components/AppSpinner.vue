<template>
	<span
		class="inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-0.125em]"
		:class="sizeClass"
		role="status"
		aria-label="Loading"
	/>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'sm' });
const SIZES: Record<string, string> = { xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-8' };
const sizeClass = computed(() => SIZES[props.size] ?? SIZES.sm);
</script>
