import type { NgrokTokenInput, NgrokTokenUpdateInput } from '~/shared/schemas';
import type { NgrokTokenList, PublicNgrokToken } from '~/shared/types';

function messageOf(e: any, fallback: string): string {
	return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? fallback;
}

export const useNgrokTokensStore = defineStore('ngrokTokens', () => {
	const tokens = ref<PublicNgrokToken[]>([]);
	const serverSecret = ref(false);
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function fetch() {
		loading.value = true;
		error.value = null;
		try {
			const res = await $fetch<NgrokTokenList>('/api/ngrok-tokens/list');
			tokens.value = res.tokens;
			serverSecret.value = res.serverSecret;
			return res;
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to load ngrok tokens');
			throw e;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: NgrokTokenInput) {
		error.value = null;
		try {
			await $fetch('/api/ngrok-tokens/create', { method: 'POST', body: payload });
			await fetch();
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to save the token');
			throw e;
		}
	}

	async function update(id: string, payload: NgrokTokenUpdateInput) {
		error.value = null;
		try {
			await $fetch(`/api/ngrok-tokens/${id}`, { method: 'PATCH', body: payload });
			await fetch();
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to update the token');
			throw e;
		}
	}

	async function remove(id: string) {
		error.value = null;
		try {
			await $fetch(`/api/ngrok-tokens/${id}`, { method: 'DELETE' });
			tokens.value = tokens.value.filter((t) => t.id !== id);
		} catch (e: any) {
			error.value = messageOf(e, 'Failed to delete the token');
			throw e;
		}
	}

	return { tokens, serverSecret, loading, error, fetch, create, update, remove };
});
