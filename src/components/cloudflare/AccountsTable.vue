<template>
	<div class="space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-muted max-w-prose">
				Tokens are sealed with envelope encryption and never leave the server in plaintext; only the
				last four characters are shown here.
			</p>
			<UButton
				icon="mdi:plus"
				@click="openCreate"
			>
				Add Account
			</UButton>
		</div>

		<UTable
			:data="store.accounts"
			:columns="columns"
			:loading="store.loading"
		>
			<template #label-cell="{ row }">
				<UContextMenu :items="rowMenu(row.original)">
					<span class="cursor-context-menu font-medium">{{ row.original.label }}</span>
				</UContextMenu>
			</template>
			<template #tokenLast4-cell="{ row }">
				<span class="font-mono text-muted"> **** {{ row.original.tokenLast4 || '????' }} </span>
			</template>
			<template #shared-cell="{ row }">
				<UBadge
					:color="row.original.shared ? 'info' : 'neutral'"
					variant="subtle"
					size="sm"
				>
					{{ row.original.shared ? 'shared' : 'personal' }}
				</UBadge>
			</template>
			<template #isDefault-cell="{ row }">
				<UBadge
					v-if="row.original.isDefault"
					color="success"
					variant="subtle"
					size="sm"
				>
					default
				</UBadge>
			</template>
			<template #slots-cell="{ row }">
				<CloudflareSlotMeter
					:used="row.original.adapterCount"
					:max="100"
					class="min-w-40"
				/>
			</template>
			<template #actions-cell="{ row }">
				<div class="flex items-center gap-1">
					<UButton
						icon="mdi:refresh"
						size="xs"
						variant="ghost"
						color="neutral"
						title="Sync"
						:loading="syncingId === row.original.id"
						@click="onSync(row.original.id)"
					/>
					<UButton
						icon="mdi:pencil"
						size="xs"
						variant="ghost"
						color="neutral"
						title="Edit"
						@click="openEdit(row.original)"
					/>
					<UButton
						icon="mdi:delete"
						size="xs"
						variant="ghost"
						color="error"
						title="Delete"
						:loading="deletingId === row.original.id"
						@click="confirmRemove(row.original)"
					/>
				</div>
			</template>
		</UTable>

		<UModal
			v-model:open="formOpen"
			:title="editing ? 'Edit Cloudflare Account' : 'Add Cloudflare Account'"
		>
			<template #body>
				<CloudflareAccountForm
					:account="editing ?? undefined"
					@submit="onFormSubmit"
					@cancel="formOpen = false"
				/>
			</template>
		</UModal>

		<UModal
			v-model:open="confirmOpen"
			title="Delete Account"
		>
			<template #body>
				<div class="space-y-4">
					<p class="text-sm">
						Delete <strong>{{ pendingDelete?.label }}</strong
						>? Adapters referencing this account will block deletion.
					</p>
					<div class="flex flex-wrap justify-end gap-2">
						<UButton
							color="neutral"
							variant="outline"
							@click="confirmOpen = false"
						>
							Cancel
						</UButton>
						<UButton
							color="error"
							icon="mdi:delete"
							:loading="!!deletingId"
							@click="doRemove"
						>
							Delete
						</UButton>
					</div>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
const store = useCfAccountsStore();
const toast = useToast();

onMounted(() => {
	if (!store.accounts.length) store.fetch();
});

const columns = [
	{ accessorKey: 'label', header: 'Label' },
	{ accessorKey: 'accountId', header: 'Account ID' },
	{ accessorKey: 'tokenLast4', header: 'Token' },
	{ accessorKey: 'tokenScope', header: 'Scope' },
	{ accessorKey: 'shared', header: 'Type' },
	{ accessorKey: 'isDefault', header: 'Default' },
	{ accessorKey: 'slots', header: 'Slots' },
	{ accessorKey: 'actions', header: '' }
];

const formOpen = ref(false);
const editing = ref<PublicCloudflareAccount | null>(null);
const syncingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);
const confirmOpen = ref(false);
const pendingDelete = ref<PublicCloudflareAccount | null>(null);

function openCreate() {
	editing.value = null;
	formOpen.value = true;
}

// right-click menu for account rows
function rowMenu(account: PublicCloudflareAccount) {
	return [
		[
			{ label: 'Sync', icon: 'mdi:refresh', onSelect: () => onSync(account.id) },
			{ label: 'Edit', icon: 'mdi:pencil', onSelect: () => openEdit(account) }
		],
		[
			{
				label: 'Delete',
				icon: 'mdi:delete',
				color: 'error',
				onSelect: () => confirmRemove(account)
			}
		]
	];
}

function openEdit(account: PublicCloudflareAccount) {
	editing.value = account;
	formOpen.value = true;
}

function onFormSubmit() {
	formOpen.value = false;
	editing.value = null;
}

async function onSync(id: string) {
	syncingId.value = id;
	try {
		await store.sync(id);
		toast.add({ title: 'Account synced', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Sync failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		syncingId.value = null;
	}
}

function confirmRemove(account: PublicCloudflareAccount) {
	pendingDelete.value = account;
	confirmOpen.value = true;
}

async function doRemove() {
	if (!pendingDelete.value) return;
	deletingId.value = pendingDelete.value.id;
	try {
		await store.remove(pendingDelete.value.id);
		toast.add({ title: 'Account deleted', color: 'success', icon: 'mdi:check' });
		confirmOpen.value = false;
	} catch (e: any) {
		toast.add({
			title: e?.data?.statusMessage ?? e?.data?.message ?? 'Delete failed',
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		deletingId.value = null;
	}
}
</script>
