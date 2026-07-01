// thin wrapper over the machines store
export function useMachines() {
	const store = useMachinesStore();
	const { machines, loading, error, usableMachines } = storeToRefs(store);
	return {
		machines,
		loading,
		error,
		usableMachines,
		fetchMachines: store.fetch,
		createMachine: store.create,
		updateMachine: store.update,
		removeMachine: store.remove,
		testMachine: store.test,
		rotateKey: store.rotateKey
	};
}
