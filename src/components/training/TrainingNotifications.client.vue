<template>
	<UChip
		:show="unseen > 0"
		:text="chipText"
		size="lg"
		position="top-right"
		inset
		color="error"
	>
		<UButton
			icon="mdi:bell-outline"
			color="neutral"
			variant="ghost"
			:title="unseen > 0 ? `${unseen} New Training Updates` : 'Training Notifications'"
			aria-label="Training Notifications"
			@click="clearUnseen"
		/>
	</UChip>
</template>

<script setup lang="ts">
// surfaces toasts for jobs that completed/failed/lost connection since last visit;
// shows an unseen count chip in the page header
const { start, stop, unseen, clearUnseen } = useTrainingNotifications();

// cap at 9+ so multi-digit counts dont overflow the chip
const chipText = computed(() => (unseen.value > 9 ? '9+' : String(unseen.value)));

onMounted(() => start());
onBeforeUnmount(() => stop());
</script>
