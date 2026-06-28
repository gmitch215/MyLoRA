<template>
	<div class="flex flex-col gap-1">
		<div class="flex items-center justify-between text-xs text-muted">
			<span class="flex items-center gap-1">
				<UIcon
					name="mdi:gauge"
					class="size-3.5"
				/>
				{{ label }}
			</span>
			<span class="tabular-nums">
				{{ used.toLocaleString() }} / {{ total.toLocaleString() }} tokens ({{ pct }}%)
			</span>
		</div>
		<div class="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
			<div
				class="h-full rounded-full transition-all"
				:class="barClass"
				:style="{ width: `${Math.min(pct, 100)}%` }"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ used: number; total: number; label?: string }>(), {
	label: 'Context Used'
});

const pct = computed(() => {
	if (!props.total) return 0;
	return Math.round((props.used / props.total) * 100);
});

// green under 75%, amber to 90%, red past it
const barClass = computed(() => {
	if (pct.value >= 90) return 'bg-error';
	if (pct.value >= 75) return 'bg-warning';
	return 'bg-primary';
});
</script>
