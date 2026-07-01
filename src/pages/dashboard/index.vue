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
					:loading="adaptersStore.mineLoading"
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
						<AdapterPushStatus
							v-if="publishStore.isActive(row.original.id)"
							compact
							:job="publishStore.states[row.original.id]?.job ?? null"
							:status="publishStore.states[row.original.id]?.status || row.original.status"
							:status-message="publishStore.states[row.original.id]?.message"
						/>
						<UBadge
							v-else
							:color="statusColor(row.original.status)"
							variant="subtle"
							class="capitalize"
						>
							{{ row.original.status }}
						</UBadge>
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
								:loading="publishStore.isActive(row.original.id)"
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
const publishStore = usePublishStore();
const toast = useToast();

// the dashboard fetches the user's OWN adapters via a dedicated call (mine=1), kept separate from the
// public grid store so its rows are never a filtered/paginated slice of the shared feed
async function refresh() {
	await adaptersStore.fetchMine();
}
// client-only: this list is user-specific (mine=1 needs the session), and an SSR $fetch does not carry
// the auth cookie - it would return public-only and drop the user's failed/unlisted rows on refresh
await useAsyncData(
	'my-adapters',
	async () => {
		await adaptersStore.fetchMine();
		return adaptersStore.mineItems.length;
	},
	{ server: false }
);

// defensive owner filter (the server already scopes mine=1 to the current user)
const mine = computed(() =>
	adaptersStore.mineItems.filter((a) => !a.authorId || a.authorId === user.value?.id)
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

// inline publish: drive THIS adapter's own push state (the server fast-fails a bad token with a clear
// 403 that surfaces as the row's failed state + message, so no separate client preflight is needed)
async function publish(adapter: Adapter) {
	try {
		await publishStore.start(adapter.id);
		toast.add({ title: 'Publish Started', color: 'info', icon: 'mdi:cloud-upload' });
		await publishStore.settled(adapter.id);
		const s = publishStore.stateFor(adapter.id);
		if (s.status === 'published') {
			toast.add({ title: 'Published', color: 'success', icon: 'mdi:check' });
		} else if (s.status === 'failed') {
			toast.add({
				title: 'Publish Failed',
				description: s.message ?? undefined,
				color: 'error',
				icon: 'mdi:alert'
			});
		}
	} catch (e: any) {
		// fast-fail (e.g. token lacks Workers AI: Edit) - show the actionable server message
		toast.add({
			title: 'Publish Failed',
			description: e?.data?.message ?? e?.data?.statusMessage ?? e?.message,
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		await refresh();
		publishStore.clear(adapter.id);
	}
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
