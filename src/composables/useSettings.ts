// thin wrapper over the settings store
export function useSettings() {
	const store = useSettingsStore();
	const { settings } = storeToRefs(store);
	return {
		settings,
		fetchSettings: store.fetch,
		saveSettings: store.save
	};
}
