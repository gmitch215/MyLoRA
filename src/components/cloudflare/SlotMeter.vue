<template>
	<div class="space-y-1">
		<div class="flex items-center justify-between text-xs">
			<span class="text-muted">{{ label ?? 'adapters' }}</span>
			<span
				class="tabular-nums"
				:class="warning ? 'text-warning font-medium' : 'text-muted'"
			>
				{{ used }} / {{ max }}
			</span>
		</div>
		<UProgress
			:model-value="used"
			:max="max"
			:color="full ? 'error' : warning ? 'warning' : 'primary'"
			size="sm"
		/>
		<p
			v-if="full"
			class="text-xs text-error"
		>
			Account is full; no slots remain until a finetune is deleted.
		</p>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		used: number;
		max?: number;
		label?: string;
	}>(),
	{ max: 100 }
);

const warning = computed(() => props.used >= props.max * 0.9);
const full = computed(() => props.used >= props.max);
</script>
