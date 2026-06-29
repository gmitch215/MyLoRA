<template>
	<div class="w-full max-w-md mx-auto p-6 rounded-lg">
		<UAlert
			v-if="success"
			color="success"
			variant="subtle"
			icon="mdi:check-circle"
			title="Successfully Logged In"
			class="mb-4"
		/>

		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="error"
			class="mb-4"
		/>

		<div class="space-y-4">
			<UInput
				id="username"
				v-model="username"
				type="text"
				autocomplete="username"
				placeholder="Username"
				icon="mdi:account"
				class="w-full"
				:disabled="loading || success"
				@keypress="handleKeyPress"
			/>
			<UInput
				id="password"
				v-model="password"
				type="password"
				autocomplete="current-password"
				placeholder="Password"
				icon="mdi:lock"
				class="w-full"
				:disabled="loading || success"
				@keypress="handleKeyPress"
			/>

			<UButton
				icon="mdi:account-lock-open"
				class="w-full justify-center py-2 px-4 font-semibold"
				:loading="loading"
				:disabled="loading || success"
				@click="handleLogin"
			>
				<span v-if="success">Logged in</span>
				<span v-else>Login</span>
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
const auth = useAuthStore();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const success = ref(false);

const emit = defineEmits<{ success: [] }>();

async function handleLogin() {
	if (!username.value || !password.value) {
		error.value = 'Username and password are required';
		return;
	}
	loading.value = true;
	error.value = '';
	try {
		const result = await auth.login(username.value.trim(), password.value);
		if (result?.ok) {
			success.value = true;
			emit('success');
		} else {
			error.value = 'Invalid credentials';
		}
	} catch (err: any) {
		const status = err?.statusCode ?? err?.status;
		if (status === 401) {
			error.value = 'Invalid credentials';
		} else if (status === 400) {
			error.value = err?.data?.statusMessage || err?.statusMessage || 'Missing credentials';
		} else {
			error.value =
				err?.data?.statusMessage || err?.statusMessage || 'An error occurred. Please try again.';
		}
	} finally {
		loading.value = false;
	}
}

function handleKeyPress(e: KeyboardEvent) {
	if (e.key === 'Enter') handleLogin();
}
</script>
