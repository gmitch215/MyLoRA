<template>
	<UBadge
		:color="meta.color"
		variant="subtle"
		size="sm"
	>
		<AppSpinner
			v-if="meta.spin"
			size="xs"
			class="shrink-0"
		/>
		<UIcon
			v-else
			:name="meta.icon"
			class="size-3.5 shrink-0"
		/>
		{{ meta.label }}
	</UBadge>
</template>

<script setup lang="ts">
const props = defineProps<{ status: JobStatus }>();

// in-flight phases spin; terminal states are static. color follows semantic tone
const STATUS_META: Record<
	JobStatus,
	{
		label: string;
		icon: string;
		color: 'primary' | 'info' | 'neutral' | 'success' | 'warning' | 'error' | 'secondary';
		spin: boolean;
	}
> = {
	queued: { label: 'Queued', icon: 'mdi:tray-full', color: 'neutral', spin: false },
	provisioning: {
		label: 'Provisioning',
		icon: 'i-lucide-loader-circle',
		color: 'warning',
		spin: true
	},
	launching: { label: 'Launching', icon: 'i-lucide-loader-circle', color: 'primary', spin: true },
	running: { label: 'Running', icon: 'i-lucide-loader-circle', color: 'info', spin: true },
	syncing: { label: 'Syncing', icon: 'i-lucide-loader-circle', color: 'secondary', spin: true },
	verifying: { label: 'Verifying', icon: 'i-lucide-loader-circle', color: 'warning', spin: true },
	publishing: { label: 'Publishing', icon: 'i-lucide-loader-circle', color: 'primary', spin: true },
	completed: { label: 'Completed', icon: 'mdi:check-circle', color: 'success', spin: false },
	failed: { label: 'Failed', icon: 'mdi:alert-circle', color: 'error', spin: false },
	abnormal: { label: 'Abnormal', icon: 'mdi:alert', color: 'error', spin: false },
	aborted: { label: 'Aborted', icon: 'mdi:cancel', color: 'neutral', spin: false }
};

const meta = computed(() => STATUS_META[props.status] ?? STATUS_META.queued);
</script>
