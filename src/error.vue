<template>
	<UApp>
		<NuxtLayout>
			<div class="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
				<UIcon
					:name="is404 ? 'mdi:compass-off-outline' : 'mdi:alert-circle-outline'"
					class="size-14 md:size-16 text-primary mb-4"
				/>
				<p class="text-sm font-semibold uppercase tracking-wide text-muted">
					Error {{ error?.statusCode || 500 }}
				</p>
				<h1 class="text-3xl md:text-4xl font-bold mt-1 mb-3">
					{{ title }}
				</h1>
				<p class="text-muted text-base md:text-lg max-w-md mb-8">
					{{ message }}
				</p>
				<div class="flex flex-wrap gap-3 justify-center">
					<UButton
						icon="mdi:home"
						color="primary"
						size="lg"
						@click="handleError"
					>
						Go Home
					</UButton>
					<UButton
						icon="mdi:refresh"
						color="neutral"
						variant="outline"
						size="lg"
						@click="reload"
					>
						Try Again
					</UButton>
				</div>
			</div>
		</NuxtLayout>
	</UApp>
</template>

<script setup lang="ts">
const props = defineProps<{
	error?: {
		statusCode?: number;
		statusMessage?: string;
		message?: string;
	};
}>();

const is404 = computed(() => props.error?.statusCode === 404);

const title = computed(() => {
	if (props.error?.statusMessage) return props.error.statusMessage;
	return is404.value ? 'Page not found' : 'Something went wrong';
});

const message = computed(() => {
	if (props.error?.message && props.error.message !== props.error?.statusMessage)
		return props.error.message;
	return is404.value
		? "We couldn't find the page you were looking for."
		: 'An unexpected error occurred. Please try again.';
});

// clearError + redirect home
function handleError() {
	clearError({ redirect: '/' });
}

function reload() {
	clearError();
	if (import.meta.client) window.location.reload();
}
</script>
