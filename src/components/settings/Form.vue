<template>
	<div
		v-if="initialLoading"
		class="flex items-center justify-center p-8"
	>
		<div class="flex flex-col items-center gap-2">
			<UIcon
				name="mdi:loading"
				class="size-8 animate-spin text-primary"
			/>
			<p class="text-sm text-muted">Loading settings...</p>
		</div>
	</div>
	<UForm
		v-else
		:schema="settingsSchema"
		:state="state"
		class="space-y-6"
		@submit="handleSubmit"
	>
		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="error"
		/>

		<!-- branding -->
		<section class="space-y-4">
			<h3 class="text-lg font-semibold text-highlighted">Branding</h3>

			<UFormField
				label="Site Name"
				name="name"
				class="min-w-60 w-3/5"
			>
				<UInput
					v-model="state.name"
					placeholder="MyLoRA"
					class="w-full"
					:disabled="loading"
				/>
			</UFormField>

			<UFormField
				label="Description"
				name="description"
				class="w-4/5"
				help="Maximum 160 characters, shown in the navigation bar"
			>
				<UTextarea
					v-model="state.description"
					placeholder="A registry of LoRA fine-tune adapters"
					class="w-full"
					:rows="3"
					:disabled="loading"
				/>
			</UFormField>

			<UFormField
				label="Author"
				name="author"
				help="Site owner / maintainer name"
				class="min-w-60 w-3/5"
			>
				<UInput
					v-model="state.author"
					placeholder="Your name"
					class="w-full"
					:disabled="loading"
				/>
			</UFormField>

			<UFormField
				label="Theme Color"
				name="themeColor"
				help="Pick a preset color or a custom hex (e.g., #3B82F6)"
			>
				<ColorPicker
					v-model="state.themeColor"
					clearable
				/>
			</UFormField>

			<UFormField
				label="Favicon (ICO)"
				name="favicon"
				help="Upload an ICO file, paste a URL, or enter a relative path"
			>
				<UInput
					v-model="state.favicon"
					placeholder="/favicon.ico"
					class="w-full"
					:disabled="loading"
				/>
			</UFormField>

			<UFormField
				label="Favicon (PNG)"
				name="faviconPng"
				help="Upload a PNG, paste a URL, or enter a relative path"
			>
				<UInput
					v-model="state.faviconPng"
					placeholder="/favicon.png"
					class="w-full"
					:disabled="loading"
				/>
			</UFormField>
		</section>

		<section class="space-y-3 border-t border-default pt-4">
			<h3 class="text-lg font-semibold text-highlighted">Banner Message</h3>
			<UFormField name="message.text">
				<UInput
					v-model="messageState.text"
					placeholder="Message shown in a banner at the top of the site"
					class="w-full"
					:disabled="loading"
				/>
			</UFormField>
			<div class="flex flex-col sm:flex-row gap-2">
				<UFormField
					name="message.type"
					class="min-w-32"
				>
					<USelect
						v-model="messageState.type"
						:items="bannerTypes"
						value-key="value"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
				<UFormField
					name="message.icon"
					class="flex-1"
				>
					<UInput
						v-model="messageState.icon"
						placeholder="mdi:information-outline"
						:icon="messageState.icon || undefined"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
			</div>
			<UBanner
				v-if="messageState.text"
				:title="messageState.text"
				:icon="messageState.icon"
				:color="messageState.type"
				class="justify-center rounded"
			/>
		</section>

		<section class="space-y-4 border-t border-default pt-4">
			<h3 class="text-lg font-semibold text-highlighted">Social</h3>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField
					label="Website"
					name="website"
				>
					<UInput
						v-model="state.website"
						placeholder="https://example.com"
						icon="mdi:web"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
				<UFormField
					label="GitHub"
					name="github"
				>
					<UInput
						v-model="state.github"
						placeholder="username"
						icon="mdi:github"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
				<UFormField
					label="Twitter/X"
					name="twitter"
				>
					<UInput
						v-model="state.twitter"
						placeholder="username"
						icon="mdi:twitter"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
				<UFormField
					label="Discord"
					name="discord"
				>
					<UInput
						v-model="state.discord"
						placeholder="discord.gg/abc123"
						icon="mdi:discord"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
				<UFormField
					label="Patreon"
					name="patreon"
				>
					<UInput
						v-model="state.patreon"
						placeholder="username"
						icon="mdi:patreon"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
				<UFormField
					label="Support Email"
					name="supportEmail"
				>
					<UInput
						v-model="state.supportEmail"
						placeholder="support@example.com"
						icon="mdi:email-outline"
						class="w-full"
						:disabled="loading"
					/>
				</UFormField>
			</div>
		</section>

		<section class="space-y-4 border-t border-default pt-4">
			<h3 class="text-lg font-semibold text-highlighted">Access</h3>
			<div class="grid gap-4 sm:grid-cols-3">
				<UFormField
					label="Download Access"
					help="Who can download assets"
				>
					<USelect
						v-model="access.downloadAccess"
						:items="accessItems"
						value-key="value"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Tester Access"
					help="Who can run inference"
				>
					<USelect
						v-model="access.testerAccess"
						:items="accessItems"
						value-key="value"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Default Visibility"
					help="For newly created adapters"
				>
					<USelect
						v-model="access.defaultVisibility"
						:items="visibilityItems"
						value-key="value"
						class="w-full capitalize"
					/>
				</UFormField>
			</div>
		</section>

		<section
			id="permissions"
			class="space-y-4 border-t border-default pt-4"
		>
			<h3 class="text-lg font-semibold text-highlighted">Permissions</h3>
			<SettingsPermissionMatrix v-model="permissions" />
		</section>

		<section
			id="rate-limit"
			class="space-y-4 border-t border-default pt-4"
		>
			<h3 class="text-lg font-semibold text-highlighted">Rate Limits</h3>
			<SettingsRateLimit v-model="rateLimits" />
		</section>

		<!-- limits -->
		<section class="space-y-4 border-t border-default pt-4">
			<h3 class="text-lg font-semibold text-highlighted">Limits</h3>
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<UFormField
					label="Max Screenshots"
					help="0-20"
				>
					<UInput
						v-model.number="limits.maxScreenshots"
						type="number"
						:min="0"
						:max="20"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Grid Page Size"
					help="6-60"
				>
					<UInput
						v-model.number="limits.gridPageSize"
						type="number"
						:min="6"
						:max="60"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Account Budget / Minute"
					help="Coarse Per-Account Request Cap"
				>
					<UInput
						v-model.number="limits.accountBudgetPerMinute"
						type="number"
						:min="1"
						:max="2000"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Inference Cache TTL (s)"
					help="0-3600"
				>
					<UInput
						v-model.number="limits.inferenceCacheTtl"
						type="number"
						:min="0"
						:max="3600"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Max Output Tokens"
					help="Caps each inference response (16-4096)"
				>
					<UInput
						v-model.number="limits.maxOutputTokens"
						type="number"
						:min="16"
						:max="4096"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Max System Prompt Chars"
					help="0 disables the system message field (0-8000)"
				>
					<UInput
						v-model.number="limits.maxSystemPromptChars"
						type="number"
						:min="0"
						:max="8000"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Max Weights (MB)"
					:help="`up to ${maxWeightsMbCeiling} MB`"
				>
					<UInput
						v-model.number="maxWeightsMb"
						type="number"
						:min="1"
						:max="maxWeightsMbCeiling"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Max Rank"
					:help="`up to ${CF_MAX_RANK}`"
				>
					<UInput
						v-model.number="limits.maxRank"
						type="number"
						:min="1"
						:max="CF_MAX_RANK"
						class="w-full"
					/>
				</UFormField>
			</div>
		</section>

		<!-- features -->
		<section class="space-y-3 border-t border-default pt-4">
			<h3 class="text-lg font-semibold text-highlighted">Features</h3>
			<p class="text-xs text-muted">
				Enable these only once Cloudflare ships the matching endpoints.
			</p>
			<USwitch
				v-model="features.cfGetEnabled"
				label="Cloudflare Single-GET Finetune"
				description="Use the real GET endpoint for sync/reconciliation"
			/>
			<USwitch
				v-model="features.cfDeleteEnabled"
				label="Cloudflare DELETE finetune"
				description="Reclaim account slots by deleting finetunes on delete"
			/>
		</section>

		<div class="flex flex-wrap gap-2 justify-end border-t border-default pt-4">
			<UButton
				color="neutral"
				variant="outline"
				:disabled="loading"
				@click="emit('cancel')"
			>
				Cancel
			</UButton>
			<UButton
				type="submit"
				icon="mdi:content-save"
				:loading="loading"
				:disabled="loading"
			>
				Save Settings
			</UButton>
		</div>
	</UForm>
</template>

<script setup lang="ts">
const store = useSettingsStore();
const toast = useToast();

const emit = defineEmits<{ submit: []; cancel: [] }>();

// branding + social + banner; the structured sections are split out below
const state = reactive<Record<string, any>>({
	name: '',
	description: '',
	author: '',
	themeColor: '',
	favicon: '',
	faviconPng: '',
	website: '',
	github: '',
	twitter: '',
	discord: '',
	patreon: '',
	supportEmail: '',
	message: { text: '', type: 'info', icon: '' }
});

const access = reactive<AccessSettings>({ ...DEFAULT_ACCESS });
const permissionsState = reactive<PermissionMatrix>(structuredClone(DEFAULT_PERMISSIONS));
const rateLimitsState = reactive<RateLimits>(structuredClone(DEFAULT_RATE_LIMITS));
const limits = reactive<LimitsSettings>({ ...DEFAULT_LIMITS });
const features = reactive<FeatureFlags>({ ...DEFAULT_FEATURES });

// v-model bridges for the matrix/rate-limit child components
const permissions = computed<PermissionMatrix>({
	get: () => permissionsState,
	set: (v) => Object.assign(permissionsState, v)
});
const rateLimits = computed<RateLimits>({
	get: () => rateLimitsState,
	set: (v) => Object.assign(rateLimitsState, v)
});

const messageState = computed(() => state.message);

const bannerTypes = [
	{ label: 'Info', value: 'info' },
	{ label: 'Success', value: 'success' },
	{ label: 'Warning', value: 'warning' },
	{ label: 'Error', value: 'error' }
];
const accessItems = [
	{ label: 'Public', value: 'public' },
	{ label: 'Login Required', value: 'login' }
];
const visibilityItems = VISIBILITIES.map((v) => ({ label: v, value: v }));

// weights shown in MB for convenience; stored in bytes
const maxWeightsMbCeiling = Math.floor(CF_MAX_WEIGHTS_BYTES / (1024 * 1024));
const maxWeightsMb = ref(Math.round(DEFAULT_LIMITS.maxWeightsBytes / (1024 * 1024)));

const loading = ref(false);
const initialLoading = ref(true);
const error = ref('');

onMounted(async () => {
	initialLoading.value = true;
	try {
		const s = await store.fetch(true);
		Object.assign(state, {
			name: s.name ?? '',
			description: s.description ?? '',
			author: s.author ?? '',
			themeColor: s.themeColor ?? '',
			favicon: s.favicon ?? '',
			faviconPng: s.faviconPng ?? '',
			website: s.website ?? '',
			github: s.github ?? '',
			twitter: s.twitter ?? '',
			discord: s.discord ?? '',
			patreon: s.patreon ?? '',
			supportEmail: s.supportEmail ?? '',
			message: (s as any).message ?? { text: '', type: 'info', icon: '' }
		});
		Object.assign(access, s.access ?? DEFAULT_ACCESS);
		Object.assign(permissionsState, s.permissions ?? DEFAULT_PERMISSIONS);
		Object.assign(rateLimitsState, s.rateLimits ?? DEFAULT_RATE_LIMITS);
		Object.assign(limits, s.limits ?? DEFAULT_LIMITS);
		Object.assign(features, s.features ?? DEFAULT_FEATURES);
		maxWeightsMb.value = Math.round(limits.maxWeightsBytes / (1024 * 1024));
	} catch {
		error.value = 'Failed to load settings';
	} finally {
		initialLoading.value = false;
	}
});

async function handleSubmit() {
	loading.value = true;
	error.value = '';
	// fold the MB input back into bytes, capped at the cf ceiling
	limits.maxWeightsBytes = Math.min(
		CF_MAX_WEIGHTS_BYTES,
		Math.max(1, Math.round(maxWeightsMb.value)) * 1024 * 1024
	);
	try {
		await store.save({
			name: state.name,
			description: state.description,
			author: state.author,
			themeColor: state.themeColor || undefined,
			favicon: state.favicon,
			faviconPng: state.faviconPng,
			website: state.website,
			github: state.github,
			twitter: state.twitter,
			discord: state.discord,
			patreon: state.patreon,
			supportEmail: state.supportEmail,
			...({ message: state.message } as any),
			access: { ...access },
			permissions: structuredClone(toRaw(permissionsState)),
			rateLimits: structuredClone(toRaw(rateLimitsState)),
			limits: { ...limits },
			features: { ...features }
		});
		toast.add({ title: 'Settings updated', color: 'success', icon: 'mdi:check' });
		emit('submit');
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? 'Failed to save settings';
		toast.add({
			title: 'Error',
			description: error.value,
			color: 'error',
			icon: 'mdi:alert-circle'
		});
	} finally {
		loading.value = false;
	}
}
</script>
