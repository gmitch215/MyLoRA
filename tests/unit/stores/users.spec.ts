import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUsersStore } from '~/stores/users';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function user(id: string, extra: Record<string, unknown> = {}) {
	return { id, username: id, role: 'developer', ...extra } as any;
}

describe('users store', () => {
	it('fetch loads users', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([user('a')]));
		const store = useUsersStore();
		const res = await store.fetch();
		expect(res).toHaveLength(1);
		expect(store.list).toHaveLength(1);
		expect(store.loading).toBe(false);
	});

	it('fetch error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'fe' } }));
		const store = useUsersStore();
		await expect(store.fetch()).rejects.toBeTruthy();
		expect(store.error).toBe('fe');
		expect(store.loading).toBe(false);
	});

	it('create pushes new user', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(user('n')));
		const store = useUsersStore();
		const res = await store.create({ username: 'n' });
		expect(res.id).toBe('n');
		expect(store.list.map((u) => u.id)).toEqual(['n']);
	});

	it('create error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useUsersStore();
		await expect(store.create({})).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to create user');
	});

	it('update patches user in place', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([user('a')]));
		const store = useUsersStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(user('a', { role: 'manager' })));
		const res = await store.update('a', { role: 'manager' });
		expect(res.role).toBe('manager');
		expect(store.list[0]!.role).toBe('manager');
	});

	it('update no-op when id missing', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(user('z')));
		const store = useUsersStore();
		const res = await store.update('z', {});
		expect(res.id).toBe('z');
		expect(store.list).toHaveLength(0);
	});

	it('update error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'ue' }));
		const store = useUsersStore();
		await expect(store.update('a', {})).rejects.toBeTruthy();
		expect(store.error).toBe('ue');
	});

	it('remove filters user out', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([user('a'), user('b')]));
		const store = useUsersStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ ok: true }));
		const res = await store.remove('a');
		expect(res.ok).toBe(true);
		expect(store.list.map((u) => u.id)).toEqual(['b']);
	});

	it('remove error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useUsersStore();
		await expect(store.remove('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to remove user');
	});
});
