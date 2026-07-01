<template>
	<UForm
		:schema="adapterSchema"
		:state="state"
		class="space-y-6"
		@submit="onSubmit"
	>
		<UAlert
			v-if="error"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="error"
		/>

		<!-- polyfill the form from a training manifest + check cloudflare compatibility -->
		<section class="space-y-3 rounded-lg border border-dashed border-default p-4 bg-elevated/30">
			<div>
				<h3 class="text-sm font-semibold text-highlighted">Auto-fill From Manifest</h3>
				<p class="text-xs text-muted">
					Upload your adapter.json or adapter_config.json to set the base model, model type and
					rank, and check Cloudflare compatibility.
				</p>
			</div>
			<UFileUpload
				v-model="manifestFile"
				accept=".json,application/json"
				label="Upload adapter.json / adapter_config.json"
				icon="mdi:file-cog"
				:disabled="parsingManifest"
			/>
			<div
				v-if="manifestChecks.length"
				class="space-y-1 rounded border border-default p-3"
			>
				<div
					v-for="(c, i) in manifestChecks"
					:key="i"
					class="flex items-start gap-2 text-xs"
				>
					<UIcon
						:name="checkIcon(c.status)"
						:class="checkClass(c.status)"
						class="mt-0.5 shrink-0"
					/>
					<span
						><span class="font-medium">{{ c.label }}:</span> {{ c.message }}</span
					>
				</div>
			</div>
		</section>

		<!-- metadata -->
		<div class="grid gap-4 sm:grid-cols-2">
			<UFormField
				label="Name"
				name="name"
				required
			>
				<UInput
					v-model="state.name"
					placeholder="My LoRA adapter"
					class="w-full"
					@blur="maybeSlugify"
				/>
			</UFormField>
			<UFormField
				label="Slug"
				name="slug"
				required
				help="lowercase letters, numbers, hyphens"
			>
				<UInput
					v-model="state.slug"
					placeholder="my-lora-adapter"
					class="w-full font-mono"
				/>
			</UFormField>
		</div>

		<UFormField
			label="Description"
			name="description"
			help="Markdown supported"
		>
			<UTabs
				:items="descTabs"
				class="w-full"
			>
				<template #write>
					<UTextarea
						v-model="state.description"
						:rows="6"
						placeholder="Describe the adapter, training data, intended use..."
						class="w-full"
					/>
				</template>
				<template #preview>
					<div
						v-if="state.description"
						class="prose prose-sm dark:prose-invert max-w-none rounded border border-default p-3"
						v-html="renderedDescription"
					/>
					<p
						v-else
						class="text-sm text-muted p-3"
					>
						Nothing to preview.
					</p>
				</template>
			</UTabs>
		</UFormField>

		<div class="grid gap-4 sm:grid-cols-2">
			<UFormField
				label="Base Model"
				name="baseModel"
				required
			>
				<USelectMenu
					v-model="state.baseModel"
					:items="baseModelItems"
					value-key="value"
					placeholder="Select a base model"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Model Type"
				name="modelType"
				help="Set automatically from the base model"
			>
				<USelect
					v-model="state.modelType"
					:items="modelTypeItems"
					value-key="value"
					class="w-full"
				/>
			</UFormField>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<UFormField
				label="Rank"
				name="rank"
				:help="`1-${maxRank}`"
				required
			>
				<UInput
					v-model.number="state.rank"
					type="number"
					:min="1"
					:max="maxRank"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Visibility"
				name="visibility"
			>
				<USelect
					v-model="state.visibility"
					:items="visibilityItems"
					value-key="value"
					class="w-full"
				/>
			</UFormField>
		</div>

		<UFormField
			label="Prompt Template"
			name="promptTemplate"
			help="Optional template wrapping user input"
		>
			<UTextarea
				v-model="state.promptTemplate"
				:rows="3"
				placeholder="<s>[INST] {prompt} [/INST]"
				class="w-full font-mono"
			/>
		</UFormField>

		<UFormField
			label="Tags"
			name="tags"
		>
			<UInputTags
				v-model="state.tags"
				placeholder="Add a tag and press enter"
				class="w-full"
			/>
		</UFormField>

		<!-- icon shown when there is no screenshot (a screenshot always overrides this) -->
		<UFormField
			label="Icon"
			name="iconName"
			help="Optional Iconify id used as the adapter's icon when no screenshot is set"
		>
			<div class="flex flex-wrap items-center gap-4">
				<div
					class="flex size-16 shrink-0 items-center justify-center rounded-lg border border-default bg-elevated/60"
				>
					<UIcon
						v-if="state.iconName"
						:name="state.iconName"
						class="size-9"
						:style="{ color: resolveColorVar(state.iconColor, 'var(--ui-text-toned)') }"
					/>
					<UIcon
						v-else
						name="mdi:cube-outline"
						class="size-8"
						:style="{ color: resolveColorVar(state.iconColor, 'var(--ui-text-dimmed)') }"
					/>
				</div>
				<div class="flex-1 space-y-2">
					<UInput
						v-model="state.iconName"
						placeholder="e.g. mdi:scale-balance"
						icon="mdi:emoticon-outline"
						class="w-full"
					/>
					<ColorPicker v-model="state.iconColor" />
				</div>
			</div>
		</UFormField>

		<!-- repeatable examples -->
		<UFormField
			label="Examples"
			name="examples"
		>
			<div class="space-y-3">
				<div
					v-for="(ex, i) in state.examples"
					:key="i"
					class="rounded border border-default p-3 space-y-2"
				>
					<div class="flex items-center justify-between">
						<span class="text-xs text-muted">Example {{ i + 1 }}</span>
						<UButton
							icon="mdi:close"
							size="xs"
							variant="ghost"
							color="error"
							@click="state.examples.splice(i, 1)"
						/>
					</div>
					<UInput
						v-model="ex.input"
						placeholder="Input"
						class="w-full"
					/>
					<UTextarea
						v-model="ex.output"
						placeholder="Expected output (optional)"
						:rows="2"
						class="w-full"
					/>
				</div>
				<UButton
					icon="mdi:plus"
					variant="outline"
					size="sm"
					@click="state.examples.push({ input: '', output: '' })"
				>
					Add Example
				</UButton>
			</div>
		</UFormField>

		<!-- assets: only available once a draft id exists -->
		<section class="space-y-4 rounded-lg border border-default p-4 bg-elevated/30">
			<h3 class="text-sm font-semibold text-highlighted">Assets</h3>
			<p
				v-if="!adapterId"
				class="text-xs text-muted"
			>
				Save the adapter first to enable config, weights and screenshot uploads.
			</p>

			<template v-else>
				<UFormField label="Config (.json)">
					<UFileUpload
						v-model="configFile"
						accept=".json,application/json"
						label="Upload adapter_config.json"
						icon="mdi:code-json"
						:disabled="upload.configState === 'uploading'"
					/>
					<UploadProgress
						v-if="upload.configState !== 'idle'"
						class="mt-2"
						:progress="upload.configState === 'done' ? 100 : upload.uploadProgress"
						:state="upload.configState"
						label="Config"
					/>
				</UFormField>

				<UFormField label="Weights (.safetensors)">
					<UFileUpload
						v-model="weightsFile"
						accept=".safetensors"
						label="Upload adapter_model.safetensors"
						icon="mdi:weight"
						:disabled="upload.weightsState === 'uploading'"
					/>
					<UploadProgress
						v-if="upload.weightsState !== 'idle'"
						class="mt-2"
						:progress="upload.weightsState === 'done' ? 100 : upload.uploadProgress"
						:state="upload.weightsState"
						label="Weights"
					/>
				</UFormField>

				<UFormField label="Screenshots">
					<ScreenshotUploader
						:adapter-id="adapterId"
						:model-value="screenshots"
						@update:model-value="screenshots = $event"
					/>
				</UFormField>
			</template>
		</section>

		<!-- publish: only with the canPublish capability -->
		<section
			v-if="adapterId && canPublish"
			class="space-y-3 rounded-lg border border-default p-4 bg-elevated/30"
		>
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-sm font-semibold text-highlighted">Publish to Cloudflare</h3>
					<p class="text-xs text-muted">
						Pushes the adapter to the finetune catalog so it can be tested.
					</p>
				</div>
				<UButton
					icon="mdi:cloud-upload"
					:loading="publishing"
					:disabled="publishing"
					@click="onPublish"
				>
					Publish
				</UButton>
			</div>

			<UFormField
				v-if="cfAccounts.length"
				label="Cloudflare Account"
			>
				<USelectMenu
					v-model="selectedAccountId"
					:items="cfAccountItems"
					value-key="value"
					:disabled="cfAccounts.length === 1"
					class="w-full"
				/>
			</UFormField>
			<p
				v-else
				class="text-xs text-muted"
			>
				No Cloudflare account available - add one in the Cloudflare tab.
			</p>
			<!-- proactive heads-up; the server still gives the authoritative result on publish -->
			<UAlert
				v-if="preflight?.canPublish === false"
				color="warning"
				variant="subtle"
				icon="mdi:alert"
				title="Publish May Fail"
				:description="preflightWarning"
			/>
			<p
				v-else-if="preflight?.canPublish === true"
				class="flex items-center gap-1 text-xs text-success"
			>
				<UIcon name="mdi:shield-check" />
				{{ preflightSuccess }}
			</p>
			<p
				v-else-if="preflight && preflight.canPublish === null"
				class="text-xs text-muted"
			>
				Cloudflare will confirm the token when you publish.
			</p>
			<PushStatus
				v-if="pushState.status && pushState.status !== 'draft'"
				:job="pushState.job"
				:status="pushState.status"
				:status-message="pushState.message"
				@retry="onPublish"
			/>
		</section>

		<div class="flex flex-wrap justify-end gap-2 border-t border-default pt-4">
			<UButton
				color="neutral"
				variant="outline"
				:disabled="saving"
				@click="emit('cancel')"
			>
				Cancel
			</UButton>
			<UButton
				type="submit"
				icon="mdi:content-save"
				:loading="saving"
			>
				{{ mode === 'create' ? 'Save Adapter' : 'Save Changes' }}
			</UButton>
		</div>
	</UForm>
</template>

<script setup lang="ts">
import type { FormSubmitEvent } from '#ui/types';

const props = defineProps<{ mode: 'create' | 'edit'; adapter?: Adapter }>();
const emit = defineEmits<{
	submit: [adapter: Adapter | { id: string; slug: string }];
	cancel: [];
}>();

const adaptersStore = useAdaptersStore();
const upload = useUploadStore();
// per-adapter publish state (kept off the shared upload singleton so publishes never cross-contaminate)
const publishStore = usePublishStore();
const cfAccountsStore = useCfAccountsStore();
const settings = useSettingsStore();
const auth = useAuthStore();
const { limits, access } = storeToRefs(settings);
const { renderMarkdown } = useMarkdown();
const toast = useToast();

const maxRank = computed(() => limits.value.maxRank);
const canPublish = computed(() => auth.can('canPublish'));

const state = reactive<AdapterInput>({
	name: props.adapter?.name ?? '',
	slug: props.adapter?.slug ?? '',
	description: props.adapter?.description ?? '',
	baseModel: props.adapter?.baseModel ?? '',
	modelType: props.adapter?.modelType ?? 'mistral',
	rank: props.adapter?.rank ?? 8,
	promptTemplate: props.adapter?.promptTemplate ?? '',
	tags: props.adapter?.tags ? [...props.adapter.tags] : [],
	examples: props.adapter?.examples?.map((e) => ({ input: e.input, output: e.output ?? '' })) ?? [],
	iconName: props.adapter?.iconName ?? '',
	iconColor: props.adapter?.iconColor ?? 'primary',
	visibility: props.adapter?.visibility ?? access.value.defaultVisibility
});

// the active draft/edit id; drives whether asset uploads are enabled
const adapterId = ref<string | null>(props.adapter?.id ?? null);
const screenshots = ref<string[]>(props.adapter?.screenshots ? [...props.adapter.screenshots] : []);

// wire the upload store to an existing adapter when editing
onMounted(() => {
	if (props.adapter) {
		upload.draftId = props.adapter.id;
		upload.draftSlug = props.adapter.slug;
		upload.status = props.adapter.status;
	}
});

const saving = ref(false);
const error = ref('');

const descTabs = [
	{ label: 'Write', slot: 'write' },
	{ label: 'Preview', slot: 'preview' }
];
const renderedDescription = computed(() => renderMarkdown(state.description ?? ''));

// capitalize the visibility value for display (label value); model types stay as technical ids
const visibilityItems = VISIBILITIES.map((v) => ({
	label: v.charAt(0).toUpperCase() + v.slice(1),
	value: v
}));
const modelTypeItems = MODEL_TYPES.map((t) => ({ label: t, value: t }));

// live base models with the static fallback; selecting one sets the model type
const baseModels = ref(DEFAULT_BASE_MODELS);
onMounted(async () => {
	try {
		const res = await $fetch<{ model: string; modelType: string }[]>('/api/infer/models');
		if (Array.isArray(res) && res.length) baseModels.value = res as typeof DEFAULT_BASE_MODELS;
	} catch {
		// keep fallback
	}
});
const baseModelItems = computed(() =>
	baseModels.value.map((m) => ({ label: m.model.split('/').pop() || m.model, value: m.model }))
);

// auto-set the model type from the chosen base model
watch(
	() => state.baseModel,
	(model) => {
		const match = baseModels.value.find((m) => m.model === model);
		if (match) state.modelType = match.modelType;
	}
);

// polyfill the form from an uploaded adapter.json / adapter_config.json
const manifestFile = ref<File | null>(null);
const parsingManifest = ref(false);
const manifestChecks = ref<ManifestCheck[]>([]);

function checkIcon(status: ManifestCheck['status']) {
	return status === 'pass'
		? 'mdi:check-circle'
		: status === 'warn'
			? 'mdi:alert'
			: 'mdi:close-circle';
}
function checkClass(status: ManifestCheck['status']) {
	return status === 'pass' ? 'text-success' : status === 'warn' ? 'text-warning' : 'text-error';
}

function applyManifest(parsed: ParsedManifest) {
	if (parsed.cfBaseModel) {
		state.baseModel = parsed.cfBaseModel; // base-model watcher sets the model type
	} else if (parsed.modelType) {
		state.modelType = parsed.modelType;
	}
	if (parsed.modelType) state.modelType = parsed.modelType;
	if (typeof parsed.rank === 'number') state.rank = parsed.rank;
}

watch(manifestFile, async (file) => {
	if (!file) return;
	parsingManifest.value = true;
	error.value = '';
	try {
		const text = await file.text();
		let manifest: unknown;
		try {
			manifest = JSON.parse(text);
		} catch {
			throw new Error('That file is not valid JSON');
		}
		const res = await $fetch<{ parsed: ParsedManifest; validation: { checks: ManifestCheck[] } }>(
			'/api/adapters/parse-manifest',
			{ method: 'POST', body: { manifest } }
		);
		applyManifest(res.parsed);
		manifestChecks.value = res.validation.checks;
		toast.add({ title: 'Form Auto-filled', color: 'success', icon: 'mdi:auto-fix' });
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? 'Could not read that manifest';
	} finally {
		parsingManifest.value = false;
		manifestFile.value = null;
	}
});

// slugify the name into the slug only while creating and only if untouched
function maybeSlugify() {
	if (props.mode !== 'create') return;
	if (state.slug) return;
	state.slug = state.name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

// upload config/weights as soon as a file is picked
const configFile = ref<File | null>(null);
const weightsFile = ref<File | null>(null);
watch(configFile, async (file) => {
	if (!file || !adapterId.value) return;
	try {
		await upload.uploadConfig(file);
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? 'Config upload failed';
	}
});
watch(weightsFile, async (file) => {
	if (!file || !adapterId.value) return;
	try {
		await upload.uploadWeights(file);
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? 'Weights upload failed';
	}
});

function payload() {
	return {
		name: state.name,
		slug: state.slug,
		description: state.description,
		baseModel: state.baseModel,
		modelType: state.modelType,
		rank: state.rank,
		promptTemplate: state.promptTemplate,
		tags: state.tags,
		examples: state.examples.filter((e) => e.input),
		iconName: state.iconName,
		iconColor: state.iconColor,
		visibility: state.visibility
	};
}

async function onSubmit(_event: FormSubmitEvent<AdapterInput>) {
	saving.value = true;
	error.value = '';
	try {
		if (props.mode === 'create' && !adapterId.value) {
			// create the draft so asset uploads become available
			const res = await adaptersStore.create(payload());
			adapterId.value = res.id;
			upload.draftId = res.id;
			upload.draftSlug = res.slug;
			upload.status = 'draft';
			toast.add({ title: 'Adapter created', color: 'success', icon: 'mdi:check' });
			emit('submit', res);
		} else if (adapterId.value) {
			const updated = await adaptersStore.update({ id: adapterId.value, ...payload() });
			toast.add({ title: 'Adapter saved', color: 'success', icon: 'mdi:check' });
			emit('submit', updated);
		}
	} catch (e: any) {
		error.value =
			e?.data?.statusMessage ?? e?.data?.message ?? e?.message ?? 'Failed to save adapter';
	} finally {
		saving.value = false;
	}
}

const cfAccounts = ref<PublicCloudflareAccount[]>([]);
const selectedAccountId = ref<string | undefined>(undefined);

// select options; value is the account id (never empty string)
const cfAccountItems = computed(() =>
	cfAccounts.value.map((a) => ({
		label: `${a.label}${a.isDefault ? ' (Default)' : ''}`,
		hint: `${a.adapterCount}/100 used`,
		value: a.id
	}))
);

async function loadCfAccounts() {
	try {
		cfAccounts.value = await cfAccountsStore.available();
	} catch {
		cfAccounts.value = [];
	}
	if (selectedAccountId.value && cfAccounts.value.some((a) => a.id === selectedAccountId.value)) {
		return;
	}

	// prefer what the server would resolve, then the default account, then the first
	const resolved = preflight.value?.accountId;
	selectedAccountId.value =
		(resolved && cfAccounts.value.some((a) => a.id === resolved) ? resolved : undefined) ??
		cfAccounts.value.find((a) => a.isDefault)?.id ??
		cfAccounts.value[0]?.id ??
		undefined;
}

// proactive publish preflight: probe whether the SELECTED account's token can publish, as an upfront heads-up
type Preflight = {
	canPublish: boolean | null;
	detail: string;
	accountLabel: string | null;
	accountId: string | null;
};
const preflight = ref<Preflight | null>(null);
const preflightWarning = computed(() =>
	preflight.value
		? `${preflight.value.detail} Create a Cloudflare API token with Workers AI: Edit and update the hosting account.`
		: ''
);
const preflightSuccess = computed(() => {
	const label = preflight.value?.accountLabel;
	return `Token is valid and authorized for Workers AI.${label ? ` (publishing to ${label})` : ''}`;
});

async function runPreflight() {
	if (!adapterId.value) return;
	try {
		preflight.value = await publishStore.preflight(adapterId.value, selectedAccountId.value);
	} catch {
		// undetermined; stay silent
		preflight.value = null;
	}
}

// this adapter's own push state (drives the PushStatus block); read the map directly to avoid
// mutating store state from inside a computed
const EMPTY_PUSH = { status: null, job: null, message: null, polling: false, error: null } as const;
const pushState = computed(() =>
	adapterId.value ? (publishStore.states[adapterId.value] ?? EMPTY_PUSH) : EMPTY_PUSH
);

// run once when the publish section is visible for an existing adapter
watch(
	() => adapterId.value && canPublish.value,
	async (shown) => {
		if (!shown) return;
		if (!preflight.value) await runPreflight();
		await loadCfAccounts();
	},
	{ immediate: true }
);

// re-preflight whenever the chosen account changes
watch(selectedAccountId, () => runPreflight());
const publishing = computed(() =>
	adapterId.value ? publishStore.isActive(adapterId.value) : false
);

async function onPublish() {
	if (!adapterId.value) return;
	error.value = '';
	try {
		await publishStore.start(adapterId.value, selectedAccountId.value);
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.data?.statusMessage ?? e?.message ?? 'Publish failed';
		// re-probe so the warning reflects the now-known-bad token
		runPreflight();
	}
}

onBeforeUnmount(() => {
	if (adapterId.value) publishStore.stop(adapterId.value);
});
</script>
