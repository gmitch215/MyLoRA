export const useMachinesStore = defineStore('machines', () => {
	const machines = ref<PublicMachine[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function fetch() {
		loading.value = true;
		error.value = null;
		try {
			const res = await $fetch<{ machines: PublicMachine[] }>('/api/machines/list');
			machines.value = res.machines;
			return machines.value;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to load machines';
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: MachineCreateInput) {
		error.value = null;
		try {
			const res = await $fetch<{ machine: PublicMachine; publicKey?: string }>(
				'/api/machines/create',
				{ method: 'POST', body: payload }
			);
			machines.value.push(res.machine);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to create machine';
			throw e;
		}
	}

	async function update(id: string, payload: MachineUpdateInput) {
		error.value = null;
		try {
			const res = await $fetch<{ machine: PublicMachine }>(`/api/machines/${id}`, {
				method: 'PATCH',
				body: payload
			});
			const idx = machines.value.findIndex((m) => m.id === id);
			if (idx !== -1) machines.value[idx] = res.machine;
			return res.machine;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to update machine';
			throw e;
		}
	}

	async function remove(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ ok: boolean }>(`/api/machines/${id}`, { method: 'DELETE' });
			machines.value = machines.value.filter((m) => m.id !== id);
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to remove machine';
			throw e;
		}
	}

	async function test(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ machine: PublicMachine; diagnosis: ConnectionDiagnosis }>(
				`/api/machines/${id}/test`,
				{ method: 'POST' }
			);
			const idx = machines.value.findIndex((m) => m.id === id);
			if (idx !== -1) machines.value[idx] = res.machine;
			return res.diagnosis;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to test connection';
			throw e;
		}
	}

	async function rotateKey(id: string) {
		error.value = null;
		try {
			const res = await $fetch<{ machine: PublicMachine; publicKey: string }>(
				`/api/machines/${id}/rotate-key`,
				{ method: 'POST' }
			);
			const idx = machines.value.findIndex((m) => m.id === id);
			if (idx !== -1) machines.value[idx] = res.machine;
			return res.publicKey;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to rotate key';
			throw e;
		}
	}

	// kick off a background dependency prepare (warms the box's uv wheel cache + records the scope)
	async function prepare(
		id: string,
		opts: { doc2loraExtras: 'core' | 'docs' | 'all'; load4bit?: boolean; pythonVersion?: string }
	) {
		error.value = null;
		try {
			const res = await $fetch<{ machine: PublicMachine; message: string }>(
				`/api/machines/${id}/prepare`,
				{ method: 'POST', body: opts }
			);
			const idx = machines.value.findIndex((m) => m.id === id);
			if (idx !== -1) machines.value[idx] = res.machine;
			return res.message;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Failed to prepare machine';
			throw e;
		}
	}

	const usableMachines = computed(() => machines.value.filter((m) => m.isActive));

	return {
		machines,
		loading,
		error,
		fetch,
		create,
		update,
		remove,
		test,
		rotateKey,
		prepare,
		usableMachines
	};
});
