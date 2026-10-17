import type { EndpointCreateInput, EndpointUpdateInput, ServeStartInput } from '~/shared/schemas';
import type { PublicEndpoint } from '~/shared/types';

function messageOf(e: any, fallback: string): string {
	return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? fallback;
}

export const useEndpointsStore = defineStore('endpoints', () => {
	const endpoints = ref<PublicEndpoint[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);

	function replace(next: PublicEndpoint) {
		const i = endpoints.value.findIndex((e) => e.id === next.id);
		if (i === -1) endpoints.value.unshift(next);
		else endpoints.value[i] = next;
		return next;
	}

	async function fetch() {
		loading.value = true;
		error.value = null;
		try {
			endpoints.value = await $fetch<PublicEndpoint[]>('/api/endpoints/list');
			return endpoints.value;
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to load endpoints');
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: EndpointCreateInput) {
		error.value = null;
		try {
			return replace(
				await $fetch<PublicEndpoint>('/api/endpoints/create', { method: 'POST', body: payload })
			);
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to create endpoint');
			throw e;
		}
	}

	async function update(id: string, payload: EndpointUpdateInput) {
		error.value = null;
		try {
			return replace(
				await $fetch<PublicEndpoint>(`/api/endpoints/${id}`, { method: 'PATCH', body: payload })
			);
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to update endpoint');
			throw e;
		}
	}

	async function remove(id: string) {
		error.value = null;
		try {
			await $fetch(`/api/endpoints/${id}`, { method: 'DELETE' });
			endpoints.value = endpoints.value.filter((e) => e.id !== id);
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to delete endpoint');
			throw e;
		}
	}

	async function test(id: string) {
		const res = await $fetch<{ endpoint: PublicEndpoint; models: string[] }>(
			`/api/endpoints/${id}/test`,
			{ method: 'POST' }
		);
		replace(res.endpoint);
		return res;
	}

	async function startServe(payload: ServeStartInput) {
		error.value = null;
		try {
			return replace(
				await $fetch<PublicEndpoint>('/api/endpoints/serve', { method: 'POST', body: payload })
			);
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to start the server');
			throw e;
		}
	}

	async function poll(id: string) {
		return replace(await $fetch<PublicEndpoint>(`/api/endpoints/${id}/poll`, { method: 'POST' }));
	}

	async function stop(id: string) {
		return replace(await $fetch<PublicEndpoint>(`/api/endpoints/${id}/stop`, { method: 'POST' }));
	}

	return { endpoints, loading, error, fetch, create, update, remove, test, startServe, poll, stop };
});
