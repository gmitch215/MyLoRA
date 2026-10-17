<template>
	<div class="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
		<h1 class="text-2xl font-bold">{{ heading }}</h1>
		<p class="text-muted">{{ message }}</p>
		<UButton
			v-if="state === 'idle' || state === 'loading'"
			color="primary"
			:loading="state === 'loading'"
			@click="confirm"
		>
			Confirm Email Address
		</UButton>
		<UButton
			v-else
			to="/profile"
			color="neutral"
			variant="outline"
		>
			Back to Profile
		</UButton>
	</div>
</template>

<script setup lang="ts">
const route = useRoute();
const { settings } = useSettings();
const config = useRuntimeConfig();
const siteName = settings.value.name || config.public.name;

useSeoMeta({ title: `Confirm Email - ${siteName}`, robots: 'noindex, nofollow' });

const id = String(route.query.id ?? '');
const token = String(route.query.token ?? '');
const state = ref<'idle' | 'loading' | 'done' | 'error'>(id && token ? 'idle' : 'error');
const errorMessage = ref('This link is invalid or has expired.');

const heading = computed(() => {
	if (state.value === 'done') return 'Email Confirmed';
	if (state.value === 'error') return 'Could Not Confirm';
	return 'Confirm Email Address';
});

const message = computed(() => {
	if (state.value === 'done') return 'You can now get training job emails at this address.';
	if (state.value === 'error') return errorMessage.value;
	return `Confirm that this address belongs to you on ${siteName}.`;
});

async function confirm() {
	state.value = 'loading';
	try {
		await $fetch('/api/users/confirm-email', { method: 'POST', body: { id, token } });
		state.value = 'done';
	} catch (err: any) {
		errorMessage.value = err?.data?.statusMessage || errorMessage.value;
		state.value = 'error';
	}
}
</script>
