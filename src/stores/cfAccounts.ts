export const useCfAccountsStore = defineStore('cfAccounts', () => {
	const accounts = ref<PublicCloudflareAccount[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function fetch() {
		loading.value = true;
		error.value = null;
		try {
			accounts.value = await $fetch<PublicCloudflareAccount[]>('/api/cf-accounts/list');
			return accounts.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load accounts';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: Record<string, unknown>) {
		error.value = null;
		try {
			const acct = await $fetch<PublicCloudflareAccount>('/api/cf-accounts/create', {
				method: 'POST',
				body: payload
			});
			accounts.value.push(acct);
			return acct;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to create account';
			throw e;
		}
	}

	async function update(id: string, payload: Record<string, unknown>) {
		error.value = null;
		try {
			const acct = await $fetch<PublicCloudflareAccount>(`/api/cf-accounts/${id}`, {
				method: 'PATCH',
				body: payload
			});
			const idx = accounts.value.findIndex((a) => a.id === id);
			if (idx !== -1) accounts.value[idx] = acct;
			return acct;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to update account';
			throw e;
		}
	}

	async function remove(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ ok: boolean }>(`/api/cf-accounts/${id}`, { method: 'DELETE' });
			accounts.value = accounts.value.filter((a) => a.id !== id);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to remove account';
			throw e;
		}
	}

	async function sync(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ finetunes: number; adapterCount: number }>(
				`/api/cf-accounts/${id}/sync`
			);
			const idx = accounts.value.findIndex((a) => a.id === id);
			if (idx !== -1)
				accounts.value[idx] = { ...accounts.value[idx]!, adapterCount: res.adapterCount };
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to sync account';
			throw e;
		}
	}

	// promote one account to default via patch; the server clears the others
	async function setDefault(id: string) {
		return update(id, { isDefault: true });
	}

	const defaultAccount = computed(() => accounts.value.find((a) => a.isDefault) ?? null);
	const totalSlotsUsed = computed(() =>
		accounts.value.reduce((sum, a) => sum + (a.adapterCount ?? 0), 0)
	);

	return {
		accounts,
		loading,
		error,
		fetch,
		create,
		update,
		remove,
		sync,
		setDefault,
		defaultAccount,
		totalSlotsUsed
	};
});
