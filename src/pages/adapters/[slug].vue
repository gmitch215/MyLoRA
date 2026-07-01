<template>
	<div
		v-if="adapter"
		class="w-full max-w-7xl mx-auto px-4 sm:px-8 py-8"
	>
		<header class="mb-6">
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex min-w-0 items-start gap-3">
					<div
						v-if="adapter.iconName && !adapter.screenshots?.length"
						class="flex size-12 shrink-0 items-center justify-center rounded-lg border border-default bg-elevated/60"
					>
						<UIcon
							:name="adapter.iconName"
							class="size-8"
							:style="{ color: resolveColorVar(adapter.iconColor, 'var(--ui-text-toned)') }"
						/>
					</div>
					<div class="min-w-0">
						<h1 class="text-3xl md:text-4xl font-bold wrap-break-word">{{ adapter.name }}</h1>
						<div class="flex flex-wrap items-center gap-2 mt-3">
							<AdapterBaseBadge :model="adapter.baseModel" />
							<AdapterModelBadge :type="adapter.modelType" />
							<UBadge
								color="neutral"
								variant="soft"
							>
								rank {{ adapter.rank }}
							</UBadge>
							<UBadge
								color="neutral"
								variant="soft"
							>
								{{ formatBytes(adapter.weightsBytes) }}
							</UBadge>
							<UBadge
								v-if="adapter.status !== 'published'"
								:color="statusColor"
								variant="subtle"
							>
								{{ adapter.status }}
							</UBadge>
						</div>
					</div>
				</div>

				<div
					v-if="canEdit || canDelete"
					class="flex flex-wrap gap-2"
				>
					<UButton
						v-if="canEdit"
						icon="mdi:pencil"
						color="neutral"
						variant="outline"
						@click="editOpen = true"
					>
						Edit
					</UButton>
					<UButton
						v-if="canDelete"
						icon="mdi:delete"
						color="error"
						variant="outline"
						:loading="deleting"
						@click="deleteOpen = true"
					>
						Delete
					</UButton>
				</div>
			</div>

			<NuxtLink
				v-if="adapter.author"
				:to="`/authors/${adapter.author.username}`"
				class="inline-flex items-center gap-2 mt-4 hover:opacity-80"
			>
				<Avatar
					:pathname="adapter.author.avatarPathname"
					:display-name="adapter.author.displayName"
					size="sm"
				/>
				<span class="text-sm text-muted">{{ adapter.author.displayName }}</span>
			</NuxtLink>
		</header>

		<ScreenshotCarousel
			v-if="adapter.screenshots?.length"
			:screenshots="adapter.screenshots"
			class="mb-8"
		/>

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
			<div class="lg:col-span-2 min-w-0 space-y-8">
				<section v-if="adapter.description">
					<div
						class="prose dark:prose-invert max-w-none"
						v-html="descriptionHtml"
					/>
				</section>

				<section v-if="adapter.promptTemplate">
					<h2 class="text-xl font-semibold mb-3">Prompt Template</h2>
					<div class="relative">
						<pre
							class="scrollbar-hide bg-elevated border border-default rounded-lg p-4 overflow-x-auto text-sm whitespace-pre-wrap wrap-break-word"
							>{{ adapter.promptTemplate }}</pre>
						<UButton
							icon="mdi:content-copy"
							color="neutral"
							variant="ghost"
							size="sm"
							class="absolute top-2 right-2"
							:title="copied ? 'Copied' : 'Copy'"
							@click="copyTemplate"
						/>
					</div>
				</section>

				<section v-if="adapter.examples?.length">
					<h2 class="text-xl font-semibold mb-3">Examples</h2>
					<div class="space-y-3">
						<UCard
							v-for="(ex, i) in adapter.examples"
							:key="i"
						>
							<div class="space-y-2">
								<div>
									<p class="text-xs font-semibold uppercase text-muted mb-1">Input</p>
									<p class="whitespace-pre-wrap wrap-break-word text-sm">{{ ex.input }}</p>
								</div>
								<div v-if="ex.output">
									<p class="text-xs font-semibold uppercase text-muted mb-1">Output</p>
									<p class="whitespace-pre-wrap wrap-break-word text-sm text-muted">
										{{ ex.output }}
									</p>
								</div>
							</div>
						</UCard>
					</div>
				</section>

				<section v-if="isTestable(adapter.status)">
					<h2 class="text-xl font-semibold mb-3">Try It</h2>
					<AdapterInferenceWidget :adapter="adapter" />
				</section>
			</div>

			<aside class="space-y-6">
				<UCard>
					<template #header>
						<h3 class="font-semibold">Details</h3>
					</template>
					<dl class="space-y-2 text-sm">
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Base Model</dt>
							<dd class="text-right break-all">{{ adapter.baseModel }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Model Type</dt>
							<dd>{{ adapter.modelType }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Rank</dt>
							<dd>{{ adapter.rank }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Weights</dt>
							<dd>{{ formatBytes(adapter.weightsBytes) }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Config</dt>
							<dd>{{ formatBytes(adapter.configBytes) }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Visibility</dt>
							<dd>{{ adapter.visibility }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Downloads</dt>
							<dd>{{ adapter.downloadCount }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Inferences</dt>
							<dd>{{ adapter.inferenceCount }}</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Uploaded</dt>
							<dd>
								<RelativeTime
									:date="adapter.created_at"
									:muted="false"
								/>
							</dd>
						</div>
						<div class="flex justify-between gap-4">
							<dt class="text-muted">Updated</dt>
							<dd>
								<RelativeTime
									:date="adapter.updated_at"
									:muted="false"
								/>
							</dd>
						</div>
					</dl>
				</UCard>

				<AdapterDownloadButtons
					v-if="adapter.status !== 'migrated'"
					:adapter="adapter"
				/>
				<UAlert
					v-else
					color="secondary"
					variant="subtle"
					icon="mdi:cloud-sync"
					title="Imported From Cloudflare"
					description="This adapter was discovered on a connected Cloudflare account. Its files are not hosted here, so downloads are unavailable - but you can test it in the playground."
				/>

				<UCard
					v-if="adapter.configBytes > 0 && adapter.weightsBytes > 0"
					variant="subtle"
				>
					<template #header>
						<h3 class="font-semibold">Add to Your Cloudflare Account</h3>
					</template>
					<div class="space-y-3 text-sm">
						<p class="text-xs text-muted">
							Registers this adapter on your own account using your local wrangler login. We never
							receive your Cloudflare token.
						</p>
						<div class="flex items-start gap-2">
							<code class="flex-1 rounded bg-elevated px-2 py-1.5 font-mono text-xs break-all">
								{{ installCmd }}
							</code>
							<UButton
								:icon="installCopied ? 'mdi:check' : 'mdi:content-copy'"
								color="neutral"
								variant="outline"
								size="xs"
								:title="installCopied ? 'Copied' : 'Copy'"
								@click="copyInstall"
							/>
						</div>
						<p class="text-xs text-muted">
							Prefer to run it yourself? Download both files above, then
							<code class="font-mono">wrangler ai finetune create {{ adapter.baseModel }}</code
							>. Always&nbsp;<a
								:href="installUrl"
								target="_blank"
								class="text-primary font-bold underline"
								>review the script</a
							>&nbsp;before piping to bash.
						</p>
					</div>
				</UCard>
			</aside>
		</div>

		<AdapterFormModal
			v-if="canEdit"
			v-model:open="editOpen"
			mode="edit"
			:adapter="adapter"
			@submit="onEditSubmit"
			@close="editOpen = false"
		/>

		<UModal
			v-model:open="deleteOpen"
			:title="`Delete ${adapter?.name}?`"
		>
			<template #body>
				<p class="mb-4 text-muted text-sm">
					This removes the adapter and its files. If Cloudflare delete is not enabled, the finetune
					slot stays consumed until reclaimed. This cannot be undone.
				</p>
				<div class="flex flex-wrap justify-end gap-2">
					<UButton
						color="neutral"
						variant="ghost"
						label="Cancel"
						@click="deleteOpen = false"
					/>
					<UButton
						color="error"
						label="Delete"
						:loading="deleting"
						@click="doDelete"
					/>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
const route = useRoute();
const adaptersStore = useAdaptersStore();
const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const config = useRuntimeConfig();
const { renderMarkdown } = useMarkdown();
const toast = useToast();

const slug = computed(() => String(route.params.slug || ''));

const { data, error } = await useAsyncData(
	() => `adapter:${slug.value}`,
	() => adaptersStore.fetchOne(slug.value)
);

if (error.value || !data.value) {
	throw createError({
		statusCode: 404,
		statusMessage: 'Adapter Not Found',
		message: 'No adapter by that slug.',
		fatal: false
	});
}

const adapter = computed(() => adaptersStore.current ?? data.value);

const descriptionHtml = computed(() =>
	adapter.value?.description ? renderMarkdown(adapter.value.description) : ''
);

const statusColor = computed(() => {
	switch (adapter.value?.status) {
		case 'failed':
			return 'error';
		case 'pushing':
			return 'warning';
		case 'archived':
			return 'neutral';
		case 'migrated':
			return 'secondary';
		default:
			return 'info';
	}
});

// owner-or-permission gating for edit/delete
const isOwner = computed(() => !!authStore.user && adapter.value?.authorId === authStore.user.id);
const canEdit = computed(
	() => (isOwner.value && authStore.can('canEditOwn')) || authStore.can('canEditAny')
);
const canDelete = computed(
	() => (isOwner.value && authStore.can('canDeleteOwn')) || authStore.can('canDeleteAny')
);

const editOpen = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);
const copied = ref(false);

// open edit/delete from a deep-link (?edit=1 / ?delete=1) used by the card context menu
onMounted(() => {
	if (route.query.edit && canEdit.value) editOpen.value = true;
	if (route.query.delete && canDelete.value) deleteOpen.value = true;
});

function copyTemplate() {
	if (!adapter.value?.promptTemplate || !import.meta.client) return;
	navigator.clipboard.writeText(adapter.value.promptTemplate);
	copied.value = true;
	setTimeout(() => (copied.value = false), 1500);
}

// one-liner installer that adds this adapter to the visitor's own cloudflare account
const installUrl = computed(() => {
	const origin = config.public.site_url || useRequestURL().origin;
	return `${origin}/adapters/${slug.value}/install.sh`;
});
const installCmd = computed(() => `curl -fsSL ${installUrl.value} | bash`);
const installCopied = ref(false);
function copyInstall() {
	if (!import.meta.client) return;
	navigator.clipboard.writeText(installCmd.value);
	installCopied.value = true;
	setTimeout(() => (installCopied.value = false), 1500);
}

async function onEditSubmit() {
	editOpen.value = false;
	await adaptersStore.fetchOne(slug.value);
}

async function doDelete() {
	if (!adapter.value) return;
	deleting.value = true;
	try {
		await adaptersStore.remove(adapter.value.id);
		toast.add({ title: 'Adapter deleted', color: 'success', icon: 'mdi:check' });
		await navigateTo('/');
	} catch (e: any) {
		toast.add({
			title: 'Delete failed',
			description: e?.data?.message ?? e?.message,
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		deleting.value = false;
		deleteOpen.value = false;
	}
}

// view tracking
const analytics = useAnalytics(() => slug.value);
onMounted(() => analytics.start());
onBeforeUnmount(() => analytics.stop());

const siteName = computed(() => settingsStore.name || config.public.name);
useSeoMeta({
	title: () => `${adapter.value?.name ?? 'Adapter'} | ${siteName.value}`,
	description: () =>
		adapter.value?.description?.slice(0, 160) || `LoRA adapter for ${adapter.value?.baseModel}`,
	ogTitle: () => adapter.value?.name,
	ogImage: () => adapter.value?.screenshots?.[0]
});
</script>
