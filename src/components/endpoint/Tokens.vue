<template>
	<section class="space-y-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="space-y-1">
				<h3 class="text-lg font-semibold text-highlighted">ngrok Tokens</h3>
				<p class="max-w-prose text-xs text-muted">
					Authtokens for serve jobs that use ngrok. They are envelope-encrypted like Cloudflare
					account tokens and only the last 4 characters are shown.
					<template v-if="store.serverSecret"
						>This server also has its own token (NUXT_NGROK_AUTHTOKEN).
					</template>
				</p>
			</div>
			<UButton
				icon="mdi:plus"
				variant="outline"
				@click="open = true"
			>
				Add Token
			</UButton>
		</div>

		<UTable
			:data="store.tokens"
			:columns="columns"
			:loading="store.loading"
		>
			<template #label-cell="{ row }">
				<div class="flex items-center gap-2">
					<span class="font-medium text-highlighted">{{ row.original.label }}</span>
					<UBadge
						:color="row.original.shared ? 'info' : 'neutral'"
						variant="subtle"
						size="sm"
					>
						{{ row.original.shared ? 'shared' : 'personal' }}
					</UBadge>
					<UBadge
						v-if="row.original.isDefault"
						color="success"
						variant="subtle"
						size="sm"
					>
						default
					</UBadge>
				</div>
			</template>
			<template #tokenLast4-cell="{ row }">
				<span class="font-mono text-muted">...{{ row.original.tokenLast4 }}</span>
			</template>
			<template #actions-cell="{ row }">
				<div class="flex items-center gap-1">
					<UButton
						v-if="canEdit(row.original)"
						:icon="row.original.isDefault ? 'mdi:star' : 'mdi:star-outline'"
						size="xs"
						variant="ghost"
						color="neutral"
						:title="row.original.isDefault ? 'Remove Default' : 'Make Default'"
						:aria-label="row.original.isDefault ? 'Remove Default' : 'Make Default'"
						@click="toggleDefault(row.original)"
					/>
					<UButton
						v-if="canEdit(row.original)"
						icon="mdi:delete"
						size="xs"
						variant="ghost"
						color="error"
						title="Delete Token"
						aria-label="Delete Token"
						@click="remove(row.original)"
					/>
				</div>
			</template>
		</UTable>

		<UModal
			v-model:open="open"
			title="Add ngrok Token"
			:dismissible="false"
			:close="false"
		>
			<template #body>
				<form
					class="space-y-4"
					@submit.prevent="onSubmit"
				>
					<UFormField
						label="Label"
						name="label"
					>
						<UInput
							v-model="state.label"
							placeholder="Team ngrok"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						label="Authtoken"
						name="token"
						help="From the ngrok dashboard under Your Authtoken"
					>
						<UInput
							v-model="state.token"
							type="password"
							autocomplete="new-password"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						name="shared"
						description="Anyone who can start a server can use it"
					>
						<USwitch
							v-model="state.shared"
							label="Shared"
						/>
					</UFormField>
					<UFormField
						name="isDefault"
						description="Used when a server picks the token automatically"
					>
						<USwitch
							v-model="state.isDefault"
							label="Default"
						/>
					</UFormField>
					<UAlert
						v-if="error"
						color="error"
						variant="subtle"
						icon="mdi:alert-circle"
						:title="error"
					/>
					<div class="flex flex-wrap justify-end gap-2">
						<UButton
							color="neutral"
							variant="outline"
							@click="open = false"
						>
							Cancel
						</UButton>
						<UButton
							type="submit"
							icon="mdi:content-save"
							:loading="saving"
						>
							Save Token
						</UButton>
					</div>
				</form>
			</template>
		</UModal>
	</section>
</template>

<script setup lang="ts">
const store = useNgrokTokensStore();
const auth = useAuthStore();
const toast = useToast();

onMounted(() => store.fetch().catch(() => {}));

const columns = [
	{ accessorKey: 'label', header: 'Label' },
	{ accessorKey: 'tokenLast4', header: 'Token' },
	{ accessorKey: 'actions', header: '' }
];

const open = ref(false);
const saving = ref(false);
const error = ref('');
const state = reactive({ label: '', token: '', shared: false, isDefault: false });

watch(open, (isOpen) => {
	if (!isOpen) return;
	Object.assign(state, { label: '', token: '', shared: false, isDefault: false });
	error.value = '';
});

// the server enforces this too; the buttons just hide for a token the caller cannot change
function canEdit(token: PublicNgrokToken) {
	return token.ownerId === auth.user?.id || auth.user?.role === 'administrator';
}

async function onSubmit() {
	saving.value = true;
	error.value = '';
	try {
		await store.create({ ...state, label: state.label.trim(), token: state.token.trim() });
		open.value = false;
		toast.add({ title: 'Token Saved', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		error.value = e?.data?.statusMessage || 'Could not save the token';
	} finally {
		saving.value = false;
	}
}

async function toggleDefault(token: PublicNgrokToken) {
	try {
		await store.update(token.id, { isDefault: !token.isDefault });
	} catch (e: any) {
		toast.add({
			title: 'Update Failed',
			description: e?.data?.statusMessage || 'Could not update the token',
			color: 'error',
			icon: 'mdi:alert-circle'
		});
	}
}

async function remove(token: PublicNgrokToken) {
	try {
		await store.remove(token.id);
		toast.add({ title: 'Token Deleted', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		toast.add({
			title: 'Delete Failed',
			description: e?.data?.statusMessage || 'Could not delete the token',
			color: 'error',
			icon: 'mdi:alert-circle'
		});
	}
}
</script>
