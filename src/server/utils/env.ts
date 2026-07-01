export function isNonProdRuntime(): boolean {
	if (import.meta.dev) return true;
	try {
		return useRuntimeConfig().public.e2e === true;
	} catch {
		return false;
	}
}
