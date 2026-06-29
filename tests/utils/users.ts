import type { APIRequestContext } from '@playwright/test';
import { loginViaApi } from './auth';

export type TempUser = {
	id: string;
	username: string;
	password: string;
	displayName: string;
	role: 'developer' | 'manager' | 'administrator';
};

let seq = 0;

// create a throwaway user via the admin api so tests never mutate the shared seeded admin
export async function createUser(
	request: APIRequestContext,
	overrides: Partial<Omit<TempUser, 'id'>> = {}
): Promise<TempUser> {
	await loginViaApi(request);
	const user = {
		username: overrides.username ?? `tmp${Date.now()}x${seq++}`,
		password: overrides.password ?? 'temp-user-pw-12345',
		displayName: overrides.displayName ?? 'Temp User',
		role: overrides.role ?? ('developer' as const)
	};
	const res = await request.post('/api/admin/users', { data: user });
	if (!res.ok()) throw new Error(`create user failed: ${res.status()} ${await res.text()}`);
	const { id } = await res.json();
	return { id, ...user };
}

export async function deleteUser(request: APIRequestContext, id: string): Promise<void> {
	await loginViaApi(request);
	await request.delete(`/api/admin/users/${id}`);
}
