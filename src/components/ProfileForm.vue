<template>
	<form
		class="space-y-6"
		@submit.prevent="onSubmit"
	>
		<section class="flex items-center gap-4">
			<Avatar
				:pathname="user?.avatarPathname"
				:display-name="user?.displayName"
				size="xl"
			/>
			<div class="flex flex-col gap-2">
				<UButton
					icon="mdi:upload"
					variant="outline"
					size="sm"
					:loading="uploading"
					@click="fileInput?.click()"
				>
					{{ uploading ? 'Uploading...' : 'Change Avatar' }}
				</UButton>
				<UButton
					v-if="user?.avatarPathname"
					icon="mdi:delete"
					color="error"
					variant="ghost"
					size="sm"
					:disabled="removing"
					@click="removeAvatar"
				>
					Remove
				</UButton>
				<input
					ref="fileInput"
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					class="hidden"
					@change="onFile"
				/>
			</div>
		</section>

		<UFormField
			label="Display Name"
			name="displayName"
		>
			<UInput
				v-model="displayName"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Bio"
			name="bio"
			:hint="`${bio.length}/500`"
		>
			<UTextarea
				v-model="bio"
				class="w-full"
				:rows="4"
				:maxlength="500"
			/>
		</UFormField>

		<UFormField
			label="Email"
			name="email"
			hint="Only used for emails you turn on below"
		>
			<UInput
				v-model="email"
				type="email"
				autocomplete="email"
				:disabled="!prefsLoaded"
				class="w-full"
			/>
			<div
				v-if="savedEmail && savedEmail === email.trim().toLowerCase()"
				class="mt-2 flex items-center gap-2"
			>
				<UBadge
					:color="emailConfirmed ? 'success' : 'warning'"
					variant="subtle"
				>
					{{ emailConfirmed ? 'Confirmed' : 'Not Confirmed' }}
				</UBadge>
				<UButton
					v-if="!emailConfirmed && mailEnabled"
					size="xs"
					variant="ghost"
					:loading="resending"
					@click="resendConfirmation"
				>
					Resend Confirmation
				</UButton>
			</div>
		</UFormField>

		<UFormField
			name="notifyJobs"
			:description="
				mailEnabled
					? 'One email when a training job you launched ends, sent only to a confirmed address'
					: 'Email is not set up on this site yet, so nothing will be sent'
			"
		>
			<USwitch
				v-model="notifyJobs"
				label="Email Me About Training Jobs"
				:disabled="!prefsLoaded"
			/>
		</UFormField>

		<details class="rounded border border-default p-3">
			<summary class="cursor-pointer text-sm font-medium">Change password</summary>
			<div class="mt-3 space-y-3">
				<UFormField
					label="Current Password"
					name="currentPassword"
				>
					<UInput
						v-model="currentPassword"
						type="password"
						autocomplete="current-password"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="New Password"
					name="newPassword"
					hint="At least 8 characters"
				>
					<UInput
						v-model="newPassword"
						type="password"
						autocomplete="new-password"
						class="w-full"
					/>
				</UFormField>
			</div>
		</details>

		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="error"
		/>

		<div class="flex flex-wrap gap-2">
			<UButton
				:loading="saving"
				icon="mdi:content-save"
				color="primary"
				@click="onSubmit"
			>
				Save Changes
			</UButton>
		</div>
	</form>
</template>

<script setup lang="ts">
const auth = useAuthStore();
const { user } = storeToRefs(auth);
const toast = useToast();

const displayName = ref(user.value?.displayName ?? '');
const bio = ref(user.value?.bio ?? '');
const email = ref('');
const notifyJobs = ref(false);
const mailEnabled = ref(false);
const savedEmail = ref('');
const emailConfirmed = ref(false);
const resending = ref(false);
// the saved values arrive after mount; editing before then would be overwritten by them
const prefsLoaded = ref(false);
const currentPassword = ref('');
const newPassword = ref('');

async function loadPrefs() {
	try {
		const prefs = await $fetch<NotificationPrefs>('/api/users/me/notifications', {
			credentials: 'include'
		});
		email.value = prefs.email;
		savedEmail.value = prefs.email;
		emailConfirmed.value = prefs.emailConfirmed;
		notifyJobs.value = prefs.notifyJobs;
		mailEnabled.value = prefs.mailEnabled;
	} catch {
		// the form still works for the other fields
	} finally {
		prefsLoaded.value = true;
	}
}

onMounted(loadPrefs);

const saving = ref(false);
const uploading = ref(false);
const removing = ref(false);
const error = ref('');

const fileInput = ref<HTMLInputElement | null>(null);

async function onSubmit() {
	error.value = '';
	saving.value = true;
	try {
		const body: Record<string, unknown> = {
			displayName: displayName.value,
			bio: bio.value,
			email: email.value.trim(),
			notifyJobs: notifyJobs.value
		};
		if (newPassword.value) {
			body.currentPassword = currentPassword.value;
			body.newPassword = newPassword.value;
		}
		await $fetch('/api/users/me', { method: 'PATCH', body, credentials: 'include' });
		await auth.fetchSession();
		toast.add({ title: 'Profile updated', color: 'success', icon: 'mdi:check' });
		await loadPrefs();
		currentPassword.value = '';
		newPassword.value = '';
	} catch (e: any) {
		error.value = e?.data?.statusMessage || e?.statusMessage || 'Failed to update profile';
	} finally {
		saving.value = false;
	}
}

async function resendConfirmation() {
	resending.value = true;
	error.value = '';
	try {
		await $fetch('/api/users/me/email-confirmation', { method: 'POST', credentials: 'include' });
		toast.add({ title: 'Confirmation sent', color: 'success', icon: 'mdi:email-check' });
	} catch (e: any) {
		error.value = e?.data?.statusMessage || 'Failed to send the confirmation email';
	} finally {
		resending.value = false;
	}
}

async function onFile(ev: Event) {
	const target = ev.target as HTMLInputElement;
	const file = target.files?.[0];
	if (!file) return;
	uploading.value = true;
	error.value = '';
	try {
		const form = new FormData();
		form.append('file', file);
		await $fetch('/api/users/me/avatar', { method: 'POST', body: form, credentials: 'include' });
		await auth.fetchSession();
		toast.add({ title: 'Avatar updated', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		error.value = e?.data?.statusMessage || e?.statusMessage || 'Failed to upload avatar';
	} finally {
		uploading.value = false;
		if (target) target.value = '';
	}
}

async function removeAvatar() {
	removing.value = true;
	try {
		await $fetch('/api/users/me/avatar', { method: 'DELETE', credentials: 'include' });
		await auth.fetchSession();
		toast.add({ title: 'Avatar removed', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		error.value = e?.data?.statusMessage || 'Failed to remove avatar';
	} finally {
		removing.value = false;
	}
}
</script>
