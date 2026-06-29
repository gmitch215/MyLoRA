<template>
	<div class="w-full max-w-xl mx-auto px-4 sm:px-8 py-12">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:rocket-launch"
				class="size-12 text-primary mx-auto"
			/>
			<h1 class="text-3xl font-bold mt-3">Welcome to MyLoRA</h1>
			<p class="text-muted mt-2">
				Let's create the first administrator. You'll use this account to manage adapters, accounts,
				and site settings.
			</p>
		</div>

		<form
			class="space-y-4"
			@submit.prevent="onSubmit"
		>
			<UFormField
				label="Username"
				hint="3-32 chars, lowercase letters, numbers, hyphens, underscores"
			>
				<UInput
					v-model="username"
					autocomplete="username"
					placeholder="admin"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Display Name">
				<UInput
					v-model="displayName"
					placeholder="Your name or team name"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Password"
				hint="At least 8 characters"
			>
				<UInput
					v-model="password"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Confirm Password">
				<UInput
					v-model="confirm"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Bio (optional)"
				:hint="`${bio.length}/500`"
			>
				<UTextarea
					v-model="bio"
					:rows="3"
					:maxlength="500"
					class="w-full"
				/>
			</UFormField>

			<!-- optional config; all sections are skippable and fall back to defaults -->
			<UCollapsible class="border-t border-default pt-4">
				<UButton
					color="neutral"
					variant="ghost"
					trailing-icon="mdi:chevron-down"
					class="w-full justify-between"
				>
					Advanced Configuration (Optional)
				</UButton>
				<template #content>
					<div class="space-y-6 pt-4">
						<!-- public rate limits -->
						<div class="space-y-3">
							<h3 class="font-semibold text-sm">Public Rate Limits</h3>
							<p class="text-xs text-muted">Per-hour budget for anonymous testers.</p>
							<UFormField
								label="Prompts Per Hour"
								:hint="`${PUBLIC_LIMIT_RANGES.promptsPerHour.min}-${PUBLIC_LIMIT_RANGES.promptsPerHour.max}`"
							>
								<UInput
									v-model.number="publicPrompts"
									type="number"
									:min="PUBLIC_LIMIT_RANGES.promptsPerHour.min"
									:max="PUBLIC_LIMIT_RANGES.promptsPerHour.max"
									class="w-full"
								/>
							</UFormField>
							<UFormField
								label="Output Tokens Per Hour"
								:hint="`${PUBLIC_LIMIT_RANGES.outputTokensPerHour.min}-${PUBLIC_LIMIT_RANGES.outputTokensPerHour.max}`"
							>
								<UInput
									v-model.number="publicTokens"
									type="number"
									:min="PUBLIC_LIMIT_RANGES.outputTokensPerHour.min"
									:max="PUBLIC_LIMIT_RANGES.outputTokensPerHour.max"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Primary Limit (Precedence)">
								<USelect
									v-model="publicPrecedence"
									:items="precedenceItems"
									class="w-full"
								/>
							</UFormField>
						</div>

						<div class="space-y-3">
							<h3 class="font-semibold text-sm">Developer / Playground Limits</h3>
							<p class="text-xs text-muted">
								Per-hour budget for signed-in developers. 0 = unlimited.
							</p>
							<UFormField label="Prompts Per Hour (0 = unlimited)">
								<UInput
									v-model.number="devPrompts"
									type="number"
									:min="0"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Output Tokens Per Hour (0 = unlimited)">
								<UInput
									v-model.number="devTokens"
									type="number"
									:min="0"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Primary Limit (Precedence)">
								<USelect
									v-model="devPrecedence"
									:items="precedenceItems"
									class="w-full"
								/>
							</UFormField>
						</div>

						<!-- publish permission -->
						<div class="space-y-2">
							<h3 class="font-semibold text-sm">Who Can Publish to Cloudflare?</h3>
							<USelect
								v-model="publishMode"
								:items="publishItems"
								class="w-full"
							/>
						</div>

						<!-- access controls -->
						<div class="space-y-3">
							<h3 class="font-semibold text-sm">Access</h3>
							<UFormField label="Download Access">
								<USelect
									v-model="downloadAccess"
									:items="accessItems"
									class="w-full"
								/>
							</UFormField>
							<UFormField label="Tester Access">
								<USelect
									v-model="testerAccess"
									:items="accessItems"
									class="w-full"
								/>
							</UFormField>
						</div>
					</div>
				</template>
			</UCollapsible>

			<UAlert
				v-if="error"
				color="error"
				variant="subtle"
				icon="mdi:alert-circle"
				:title="error"
				:description="errorDetails || undefined"
			/>

			<UButton
				type="submit"
				:loading="submitting"
				color="primary"
				icon="mdi:account-plus"
				class="w-full justify-center"
				size="lg"
			>
				Create Administrator
			</UButton>
		</form>
	</div>
</template>

<script setup lang="ts">
// bypass the setup/auth global guards on this page
definePageMeta({ middleware: [] });

const { status, refresh } = useSetupStatus();
await refresh();

// already set up -> send home
if (status.value && !status.value.needsSetup) {
	await navigateTo('/');
}

const username = ref('admin');
const displayName = ref('Team');
const password = ref('');
const confirm = ref('');
const bio = ref('');

// optional settings, seeded from defaults
const publicPrompts = ref(DEFAULT_RATE_LIMITS.public.promptsPerHour);
const publicTokens = ref(DEFAULT_RATE_LIMITS.public.outputTokensPerHour);
const publicPrecedence = ref(DEFAULT_RATE_LIMITS.public.precedence);
const devPrompts = ref(DEFAULT_RATE_LIMITS.developer.promptsPerHour);
const devTokens = ref(DEFAULT_RATE_LIMITS.developer.outputTokensPerHour);
const devPrecedence = ref(DEFAULT_RATE_LIMITS.developer.precedence);
const publishMode = ref<'managers' | 'developers'>('managers');
const downloadAccess = ref(DEFAULT_ACCESS.downloadAccess);
const testerAccess = ref(DEFAULT_ACCESS.testerAccess);

const precedenceItems = [
	{ label: 'Tokens', value: 'tokens' },
	{ label: 'Prompts', value: 'prompts' }
];
const publishItems = [
	{ label: 'Managers and Admins Only (Default)', value: 'managers' },
	{ label: 'Managers, Admins, and Developers', value: 'developers' }
];
const accessItems = [
	{ label: 'Public', value: 'public' },
	{ label: 'Logged-In Users Only', value: 'login' }
];

const submitting = ref(false);
const error = ref('');
const errorDetails = ref('');

const session = useUserSession();
const toast = useToast();

// assemble the optional settings payload from the form state
function buildSettings() {
	const permissions = {
		developer: {
			...DEFAULT_PERMISSIONS.developer,
			canPublish: publishMode.value === 'developers'
		},
		manager: { ...DEFAULT_PERMISSIONS.manager }
	};
	return {
		rateLimits: {
			public: {
				promptsPerHour: clampPublicLimit('promptsPerHour', publicPrompts.value),
				outputTokensPerHour: clampPublicLimit('outputTokensPerHour', publicTokens.value),
				precedence: publicPrecedence.value
			},
			developer: {
				promptsPerHour: Math.max(0, devPrompts.value || 0),
				outputTokensPerHour: Math.max(0, devTokens.value || 0),
				precedence: devPrecedence.value
			}
		},
		permissions,
		access: {
			downloadAccess: downloadAccess.value,
			testerAccess: testerAccess.value,
			defaultVisibility: DEFAULT_ACCESS.defaultVisibility
		}
	};
}

async function onSubmit() {
	error.value = '';
	errorDetails.value = '';

	if (username.value.trim().length < 3) {
		error.value = 'Username must be at least 3 characters';
		return;
	}
	if (!displayName.value.trim()) {
		error.value = 'Display name is required';
		return;
	}
	if (password.value.length < 8) {
		error.value = 'Password must be at least 8 characters';
		return;
	}
	if (password.value.length > 128) {
		error.value = 'Password must be 128 characters or less';
		return;
	}
	if (password.value !== confirm.value) {
		error.value = 'Passwords do not match';
		return;
	}

	submitting.value = true;
	try {
		await $fetch('/api/setup/init', {
			method: 'POST',
			body: {
				username: username.value.toLowerCase().trim(),
				displayName: displayName.value.trim(),
				password: password.value,
				bio: bio.value,
				settings: buildSettings()
			},
			credentials: 'include'
		});
		toast.add({
			title: 'Welcome aboard',
			description: 'Administrator account created.',
			icon: 'mdi:rocket-launch',
			color: 'success'
		});
		status.value = {
			needsSetup: false,
			hasLegacyPassword: status.value?.hasLegacyPassword ?? false,
			userCount: Math.max(1, (status.value?.userCount ?? 0) + 1)
		};
		try {
			await session.fetch();
		} catch (e) {
			console.warn('post-setup session fetch failed:', e);
		}
		await navigateTo('/');
	} catch (e: any) {
		const issues = e?.data?.issues as { path: PropertyKey[]; message?: string }[] | undefined;
		const primary = issues
			? firstZodIssueMessage(issues, e?.data?.statusMessage || 'Setup failed')
			: e?.data?.statusMessage || e?.statusMessage || e?.message || 'Setup failed';
		error.value = primary;
		if (issues && issues.length > 1) {
			errorDetails.value = issues
				.slice(1)
				.map((i) => firstZodIssueMessage([i], i.message ?? ''))
				.filter(Boolean)
				.join(' . ');
		}
	} finally {
		submitting.value = false;
	}
}

useSeoMeta({ title: 'Setup - MyLoRA' });
</script>
