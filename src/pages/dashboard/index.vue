<template>
	<UDashboardPanel id="my-adapters">
		<template #header>
			<UDashboardNavbar
				title="My Adapters"
				icon="mdi:view-grid"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<UButton
						icon="mdi:plus"
						color="primary"
						@click="openCreate"
					>
						New Adapter
					</UButton>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<!-- kpi cards computed from the user's adapters -->
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
				<UPageCard
					v-for="kpi in kpis"
					:key="kpi.label"
					:ui="{ container: 'p-4 gap-1' }"
					:class="kpi.ring"
				>
					<div class="flex items-center gap-2 text-muted text-sm">
						<span
							class="flex size-7 items-center justify-center rounded-lg"
							:class="kpi.badge"
						>
							<UIcon
								:name="kpi.icon"
								class="size-4"
							/>
						</span>
						<span>{{ kpi.label }}</span>
					</div>
					<div class="text-2xl font-bold">{{ kpi.value }}</div>
				</UPageCard>
			</div>

			<div class="scrollbar-hide overflow-x-auto">
				<UTable
					:data="mine"
					:columns="columns"
					:loading="adaptersStore.loading"
					:empty="emptyLabel"
				>
					<template #name-cell="{ row }">
						<UContextMenu :items="buildMenu(row.original)">
							<div class="cursor-context-menu">
								<div class="font-medium">{{ row.original.name }}</div>
								<div class="text-muted text-xs">{{ row.original.slug }}</div>
							</div>
						</UContextMenu>
					</template>

					<template #status-cell="{ row }">
						<UBadge
							:color="statusColor(row.original.status)"
							variant="subtle"
							class="capitalize"
						>
							{{ row.original.status }}
						</UBadge>
						<AdapterPushStatus
							v-if="publishingId === row.original.id"
							:job="uploadStore.job"
							:status="uploadStore.status || 'draft'"
							class="mt-1"
						/>
					</template>

					<template #baseModel-cell="{ row }">
						<AdapterBaseBadge :model="row.original.baseModel" />
					</template>

					<template #downloadCount-cell="{ row }">
						{{ row.original.downloadCount }}
					</template>

					<template #inferenceCount-cell="{ row }">
						{{ row.original.inferenceCount }}
					</template>

					<template #author-cell="{ row }">
						<div class="flex items-center gap-2">
							<Avatar
								:pathname="row.original.author?.avatarPathname"
								:display-name="row.original.author?.displayName || 'Unknown'"
								size="2xs"
							/>
							<span class="text-sm">{{ row.original.author?.displayName || 'Unknown' }}</span>
						</div>
					</template>

					<template #uploaded-cell="{ row }">
						<RelativeTime :date="row.original.created_at" />
					</template>

					<template #updated-cell="{ row }">
						<RelativeTime :date="row.original.updated_at" />
					</template>

					<template #actions-cell="{ row }">
						<div class="flex items-center justify-end gap-1 whitespace-nowrap">
							<UButton
								icon="mdi:pencil"
								size="xs"
								variant="ghost"
								title="Edit"
								@click="openEdit(row.original)"
							/>
							<UButton
								v-if="canPublishRow(row.original)"
								icon="mdi:cloud-upload"
								size="xs"
								color="primary"
								variant="ghost"
								title="Publish"
								:loading="publishingId === row.original.id"
								@click="publish(row.original)"
							/>
							<UButton
								v-if="canDeleteRow(row.original)"
								icon="mdi:delete"
								size="xs"
								color="error"
								variant="ghost"
								title="Delete"
								@click="confirmDelete(row.original)"
							/>
						</div>
					</template>
				</UTable>
			</div>

			<AdapterFormModal
				v-model:open="modalOpen"
				:mode="modalMode"
				:adapter="modalAdapter || undefined"
				@submit="refresh"
			/>

			<UModal
				v-model:open="deleteOpen"
				:title="`Delete ${target?.name}?`"
			>
				<template #body>
					<p class="mb-4">
						This removes the adapter and its files. If Cloudflare delete is not enabled the finetune
						slot stays burned until reclaimed. This cannot be undone.
					</p>
					<div
						v-if="deleteError"
						class="text-sm text-error mb-2"
					>
						{{ deleteError }}
					</div>
					<div class="flex flex-wrap gap-2 justify-end">
						<UButton
							color="neutral"
							variant="ghost"
							@click="deleteOpen = false"
							>Cancel</UButton
						>
						<UButton
							color="error"
							:loading="deleting"
							@click="doDelete"
							>Delete</UButton
						>
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' });

const auth = useAuthStore();
const { user } = storeToRefs(auth);
const adaptersStore = useAdaptersStore();
const uploadStore = useUploadStore();
const toast = useToast();

// load the full list then filter to the current author client-side
async function refresh() {
	await adaptersStore.fetchList();
}
await useAsyncData('my-adapters', async () => {
	await adaptersStore.fetchList();
	return adaptersStore.items.length;
});

const mine = computed(() =>
	adaptersStore.items.filter((a) => a.authorId && a.authorId === user.value?.id)
);

const kpis = computed(() => {
	const list = mine.value;
	return [
		{
			label: 'Adapters',
			icon: 'mdi:view-grid',
			value: list.length,
			badge: 'bg-primary/10 text-primary',
			ring: 'ring-primary/20'
		},
		{
			label: 'Published',
			icon: 'mdi:cloud-check',
			value: list.filter((a) => a.status === 'published').length,
			badge: 'bg-success/10 text-success',
			ring: 'ring-success/20'
		},
		{
			label: 'Downloads',
			icon: 'mdi:download',
			value: list.reduce((s, a) => s + (a.downloadCount ?? 0), 0),
			badge: 'bg-info/10 text-info',
			ring: 'ring-info/20'
		},
		{
			label: 'Inferences',
			icon: 'mdi:flask',
			value: list.reduce((s, a) => s + (a.inferenceCount ?? 0), 0),
			badge: 'bg-warning/10 text-warning',
			ring: 'ring-warning/20'
		}
	];
});

const columns = [
	{ accessorKey: 'name', header: 'Name' },
	{ accessorKey: 'author', header: 'Author' },
	{ accessorKey: 'status', header: 'Status' },
	{ accessorKey: 'baseModel', header: 'Base Model' },
	{ accessorKey: 'downloadCount', header: 'Downloads' },
	{ accessorKey: 'inferenceCount', header: 'Inferences' },
	{ accessorKey: 'uploaded', header: 'Uploaded' },
	{ accessorKey: 'updated', header: 'Updated' },
	{ id: 'actions', header: '' }
];

const emptyLabel = 'No adapters yet. Create your first one.';

// right-click menu for table rows, reusing the existing row handlers
const buildMenu = useAdapterMenu({
	onEdit: (a) => openEdit(a),
	onDelete: (a) => confirmDelete(a),
	onPublish: (a) => publish(a)
});

function statusColor(status: AdapterStatus) {
	switch (status) {
		case 'published':
			return 'success';
		case 'pushing':
			return 'info';
		case 'failed':
			return 'error';
		case 'archived':
			return 'neutral';
		case 'migrated':
			return 'secondary';
		default:
			return 'warning';
	}
}

// modal state for create/edit
const modalOpen = ref(false);
const modalMode = ref<'create' | 'edit'>('create');
const modalAdapter = ref<Adapter | null>(null);

function openCreate() {
	modalMode.value = 'create';
	modalAdapter.value = null;
	modalOpen.value = true;
}

// the global "New Adapter" command navigates here with ?new=1
const route = useRoute();
onMounted(() => {
	if (route.query.new === '1') openCreate();
});

function openEdit(adapter: Adapter) {
	modalMode.value = 'edit';
	modalAdapter.value = adapter;
	modalOpen.value = true;
}

// publish gating: needs the capability, owner, and a listed/failed adapter
const ownsRow = (a: Adapter) => a.authorId === user.value?.id;
function canPublishRow(a: Adapter) {
	return auth.can('canPublish') && (a.status === 'listed' || a.status === 'failed');
}
function canDeleteRow(a: Adapter) {
	if (ownsRow(a)) return auth.can('canDeleteOwn');
	return auth.can('canDeleteAny');
}

// inline publish: point the upload store at this adapter, push, then poll
const publishingId = ref<string | null>(null);
async function publish(adapter: Adapter) {
	publishingId.value = adapter.id;
	uploadStore.reset();
	// reset clears draftId, so set it back to the target adapter
	uploadStore.draftId = adapter.id;
	try {
		await uploadStore.startPublish();
		toast.add({ title: 'Publish started', color: 'info', icon: 'mdi:cloud-upload' });
		// wait until the poll settles
		await waitForPublish();
		if (uploadStore.status === 'published') {
			toast.add({ title: 'Published', color: 'success', icon: 'mdi:check' });
		} else if (uploadStore.status === 'failed') {
			toast.add({
				title: 'Publish failed',
				description: uploadStore.statusMessage ?? undefined,
				color: 'error',
				icon: 'mdi:alert'
			});
		}
		await refresh();
	} catch (e: any) {
		toast.add({
			title: 'Publish failed',
			description: e?.data?.message ?? e?.message,
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		publishingId.value = null;
		uploadStore.reset();
	}
}

// resolve once the upload store stops polling (published/failed)
function waitForPublish() {
	return new Promise<void>((resolve) => {
		const stop = watch(
			() => uploadStore.polling,
			(polling) => {
				if (!polling) {
					stop();
					resolve();
				}
			},
			{ immediate: true }
		);
	});
}

// delete confirmation
const deleteOpen = ref(false);
const target = ref<Adapter | null>(null);
const deleting = ref(false);
const deleteError = ref('');

function confirmDelete(adapter: Adapter) {
	target.value = adapter;
	deleteError.value = '';
	deleteOpen.value = true;
}

async function doDelete() {
	if (!target.value) return;
	deleting.value = true;
	deleteError.value = '';
	try {
		const res = await adaptersStore.remove(target.value.id);
		toast.add({
			title: res.reclaimed ? 'Adapter deleted, slot reclaimed' : 'Adapter deleted',
			color: 'success',
			icon: 'mdi:check'
		});
		deleteOpen.value = false;
		target.value = null;
	} catch (e: any) {
		deleteError.value = e?.data?.message ?? e?.message ?? 'Failed to delete';
	} finally {
		deleting.value = false;
	}
}

useSeoMeta({ title: 'My Adapters' });
</script>
