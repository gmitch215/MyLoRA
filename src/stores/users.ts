export const useUsersStore = defineStore('users', () => {
	const list = ref<AdminUser[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function fetch() {
		loading.value = true;
		error.value = null;
		try {
			list.value = await $fetch<AdminUser[]>('/api/admin/users');
			return list.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load users';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: Record<string, unknown>) {
		error.value = null;
		try {
			const user = await $fetch<AdminUser>('/api/admin/users', {
				method: 'POST',
				body: payload
			});
			list.value.push(user);
			return user;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to create user';
			throw e;
		}
	}

	async function update(id: string, payload: Record<string, unknown>) {
		error.value = null;
		try {
			const user = await $fetch<AdminUser>(`/api/admin/users/${id}`, {
				method: 'PATCH',
				body: payload
			});
			const idx = list.value.findIndex((u) => u.id === id);
			if (idx !== -1) list.value[idx] = user;
			return user;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to update user';
			throw e;
		}
	}

	async function remove(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' });
			list.value = list.value.filter((u) => u.id !== id);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to remove user';
			throw e;
		}
	}

	return { list, loading, error, fetch, create, update, remove };
});
