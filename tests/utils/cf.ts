import type { APIRequestContext } from '@playwright/test';
import { loginViaApi } from './auth';

let seq = 0;

// register a cloudflare account via the api (token verification is mocked in test env)
export async function createCfAccount(
	request: APIRequestContext,
	overrides: Partial<{ label: string; accountId: string; apiToken: string; shared: boolean }> = {}
) {
	await loginViaApi(request);
	const account = {
		label: overrides.label ?? `test-acct-${seq++}`,
		accountId: overrides.accountId ?? '0123456789abcdef0123456789abcdef',
		apiToken: overrides.apiToken ?? 'test-token-0123456789abcdef',
		tokenScope: 'readwrite' as const,
		shared: overrides.shared ?? true,
		isDefault: false
	};
	const res = await request.post('/api/cf-accounts/create', { data: account });
	if (!res.ok()) throw new Error(`create cf account failed: ${res.status()} ${await res.text()}`);
	return res.json();
}

export async function deleteCfAccount(request: APIRequestContext, id: string) {
	await loginViaApi(request);
	return request.delete(`/api/cf-accounts/${id}`);
}

// ensure at least one shared default account exists so publish can pick a host
export async function ensureDefaultAccount(request: APIRequestContext) {
	await loginViaApi(request);
	const list = await (await request.get('/api/cf-accounts/list')).json();
	if (Array.isArray(list) && list.length > 0) return list[0];
	const res = await request.post('/api/cf-accounts/create', {
		data: {
			label: 'test-default',
			accountId: 'ffffffffffffffffffffffffffffffff',
			apiToken: 'test-token-default-0123456789',
			tokenScope: 'readwrite',
			shared: true,
			isDefault: true
		}
	});
	if (!res.ok())
		throw new Error(`ensure default account failed: ${res.status()} ${await res.text()}`);
	return res.json();
}
