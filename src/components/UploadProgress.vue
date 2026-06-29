<template>
	<div class="space-y-1">
		<div class="flex items-center justify-between text-xs">
			<span class="flex items-center gap-1.5 text-muted">
				<UIcon
					:name="stateIcon"
					:class="stateColor"
					class="size-4"
					:aria-label="state"
				/>
				<span v-if="label">{{ label }}</span>
			</span>
			<span class="tabular-nums text-muted">{{ Math.round(progress) }}%</span>
		</div>
		<UProgress
			:model-value="progress"
			:max="100"
			:color="state === 'error' ? 'error' : state === 'done' ? 'success' : 'primary'"
			size="sm"
		/>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		progress: number;
		state: string;
		label?: string;
	}>(),
	{ progress: 0, state: 'idle' }
);

const stateIcon = computed(
	() =>
		({
			idle: 'mdi:tray-arrow-up',
			uploading: 'mdi:loading',
			done: 'mdi:check-circle',
			error: 'mdi:alert-circle'
		})[props.state] ?? 'mdi:tray-arrow-up'
);

const stateColor = computed(
	() =>
		({
			idle: 'text-muted',
			uploading: 'text-primary animate-spin',
			done: 'text-success',
			error: 'text-error'
		})[props.state] ?? 'text-muted'
);
</script>
