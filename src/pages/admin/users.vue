<template>
	<UDashboardPanel id="users">
		<template #header>
			<UDashboardNavbar
				title="Users"
				icon="mdi:account-multiple"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<UButton
						icon="mdi:account-plus"
						color="primary"
						@click="openCreate"
					>
						New User
					</UButton>
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="scrollbar-hide overflow-x-auto border border-default rounded-lg">
				<table class="min-w-full text-sm">
					<thead class="bg-elevated/40 text-left">
						<tr>
							<th class="p-3">User</th>
							<th class="p-3">Role</th>
							<th class="p-3">Adapters</th>
							<th class="p-3">Status</th>
							<th class="p-3">Created</th>
							<th class="p-3 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="u in users"
							:key="u.id"
							class="border-t border-default"
						>
							<td class="p-3">
								<div class="flex items-center gap-3">
									<Avatar
										:pathname="u.avatarPathname"
										:display-name="u.displayName"
										size="sm"
									/>
									<div>
										<div class="font-medium">{{ u.displayName }}</div>
										<div class="text-muted text-xs">@{{ u.username }}</div>
									</div>
								</div>
							</td>
							<td class="p-3 capitalize">{{ u.role }}</td>
							<td class="p-3">{{ u.adapterCount }}</td>
							<td class="p-3">
								<UBadge
									:color="u.isActive ? 'success' : 'neutral'"
									variant="subtle"
								>
									{{ u.isActive ? 'Active' : 'Disabled' }}
								</UBadge>
							</td>
							<td class="p-3 text-muted">{{ formatShort(u.createdAt) }}</td>
							<td class="p-3 text-right space-x-1 whitespace-nowrap">
								<UButton
									icon="mdi:pencil"
									title="Edit"
									aria-label="Edit User"
									size="xs"
									variant="ghost"
									@click="openEdit(u)"
								/>
								<UButton
									icon="mdi:delete"
									title="Delete"
									aria-label="Delete User"
									size="xs"
									color="error"
									variant="ghost"
									:disabled="u.id === me?.id"
									@click="confirmDelete(u)"
								/>
							</td>
						</tr>
						<tr v-if="!loading && users.length === 0">
							<td
								colspan="6"
								class="p-6 text-center text-muted"
							>
								No users yet.
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<UModal
				v-model:open="formOpen"
				:title="editing ? 'Edit User' : 'New User'"
			>
				<template #body>
					<form
						class="space-y-4"
						@submit.prevent="submit"
					>
						<UFormField
							label="Username"
							hint="3-32 chars, lowercase letters, numbers, hyphens, underscores"
						>
							<UInput
								v-model="form.username"
								placeholder="jdoe"
								autocomplete="off"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Display Name">
							<UInput
								v-model="form.displayName"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Role">
							<USelect
								v-model="form.role"
								:items="roleOptions"
								class="w-full"
							/>
						</UFormField>
						<UFormField :label="editing ? 'New password (optional)' : 'Password'">
							<UInput
								v-model="form.password"
								type="password"
								autocomplete="new-password"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							v-if="editing"
							label="Active"
						>
							<USwitch v-model="form.isActive" />
						</UFormField>
						<UFormField label="Bio">
							<UTextarea
								v-model="form.bio"
								class="w-full"
								:rows="3"
								:maxlength="500"
							/>
						</UFormField>
						<div
							v-if="formError"
							class="text-sm text-error"
						>
							{{ formError }}
						</div>
						<div class="flex flex-wrap gap-2 justify-end">
							<UButton
								color="neutral"
								variant="ghost"
								@click="formOpen = false"
							>
								Cancel
							</UButton>
							<UButton
								type="submit"
								color="primary"
								:loading="saving"
							>
								{{ editing ? 'Save' : 'Create' }}
							</UButton>
						</div>
					</form>
				</template>
			</UModal>

			<UModal
				v-model:open="deleteOpen"
				:title="`Delete ${target?.displayName}?`"
			>
				<template #body>
					<p class="mb-4">
						Their adapters will be reassigned to the first administrator. This cannot be undone.
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
						>
							Cancel
						</UButton>
						<UButton
							color="error"
							:loading="deleting"
							@click="doDelete"
						>
							Delete
						</UButton>
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'admin' });

const { user: me } = useLogin();
const toast = useToast();
const usersStore = useUsersStore();
const { list: users, loading } = storeToRefs(usersStore);

await useAsyncData('admin-users', () => usersStore.fetch());

// role select options from the shared ROLES tuple
const roleOptions = ROLES.map((r) => ({
	label: r.charAt(0).toUpperCase() + r.slice(1),
	value: r
}));

const formOpen = ref(false);
const editing = ref<AdminUser | null>(null);
const form = reactive({
	username: '',
	displayName: '',
	role: 'developer' as AdminUser['role'],
	password: '',
	bio: '',
	isActive: true
});
const saving = ref(false);
const formError = ref('');

function openCreate() {
	editing.value = null;
	Object.assign(form, {
		username: '',
		displayName: '',
		role: 'developer',
		password: '',
		bio: '',
		isActive: true
	});
	formError.value = '';
	formOpen.value = true;
}

function openEdit(u: AdminUser) {
	editing.value = u;
	Object.assign(form, {
		username: u.username,
		displayName: u.displayName,
		role: u.role,
		password: '',
		bio: u.bio ?? '',
		isActive: u.isActive
	});
	formError.value = '';
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	formError.value = '';
	try {
		if (editing.value) {
			const body: Record<string, unknown> = {
				displayName: form.displayName,
				role: form.role,
				bio: form.bio,
				isActive: form.isActive
			};
			const nextUsername = form.username.toLowerCase().trim();
			if (nextUsername && nextUsername !== editing.value.username) {
				body.username = nextUsername;
			}
			if (form.password) body.password = form.password;
			await usersStore.update(editing.value.id, body);
		} else {
			await usersStore.create({
				username: form.username.toLowerCase().trim(),
				displayName: form.displayName,
				role: form.role,
				password: form.password,
				bio: form.bio
			});
		}
		toast.add({
			title: editing.value ? 'User updated' : 'User created',
			color: 'success',
			icon: 'mdi:check'
		});
		formOpen.value = false;
	} catch (e: any) {
		formError.value =
			e?.data?.message ?? e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to save';
	} finally {
		saving.value = false;
	}
}

const deleteOpen = ref(false);
const target = ref<AdminUser | null>(null);
const deleting = ref(false);
const deleteError = ref('');

function confirmDelete(u: AdminUser) {
	target.value = u;
	deleteError.value = '';
	deleteOpen.value = true;
}

async function doDelete() {
	if (!target.value) return;
	deleting.value = true;
	deleteError.value = '';
	try {
		await usersStore.remove(target.value.id);
		toast.add({ title: 'User deleted', color: 'success', icon: 'mdi:check' });
		deleteOpen.value = false;
		target.value = null;
	} catch (e: any) {
		deleteError.value =
			e?.data?.message ?? e?.data?.statusMessage ?? e?.statusMessage ?? 'Failed to delete';
	} finally {
		deleting.value = false;
	}
}

function formatShort(iso: string) {
	try {
		return new Date(iso).toLocaleDateString();
	} catch {
		return iso;
	}
}

useSeoMeta({ title: 'Admin - Users' });
</script>
