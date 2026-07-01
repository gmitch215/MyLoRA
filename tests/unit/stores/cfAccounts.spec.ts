import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCfAccountsStore } from '~/stores/cfAccounts';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function acct(id: string, extra: Record<string, unknown> = {}) {
	return { id, label: id, isDefault: false, adapterCount: 0, ...extra } as any;
}

describe('cfAccounts store', () => {
	it('fetch loads accounts', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([acct('a')]));
		const store = useCfAccountsStore();
		const res = await store.fetch();
		expect(res).toHaveLength(1);
		expect(store.accounts).toHaveLength(1);
		expect(store.loading).toBe(false);
	});

	it('fetch error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'e1' } }));
		const store = useCfAccountsStore();
		await expect(store.fetch()).rejects.toBeTruthy();
		expect(store.error).toBe('e1');
		expect(store.loading).toBe(false);
	});

	it('create pushes new account', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(acct('new')));
		const store = useCfAccountsStore();
		const res = await store.create({ label: 'new' });
		expect(res.id).toBe('new');
		expect(store.accounts.map((a) => a.id)).toEqual(['new']);
	});

	it('create error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useCfAccountsStore();
		await expect(store.create({})).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to create account');
	});

	it('update patches account in place', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([acct('a')]));
		const store = useCfAccountsStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(acct('a', { label: 'renamed' })));
		const res = await store.update('a', { label: 'renamed' });
		expect(res.label).toBe('renamed');
		expect(store.accounts[0]!.label).toBe('renamed');
	});

	it('update no-op when id missing', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(acct('z')));
		const store = useCfAccountsStore();
		const res = await store.update('z', {});
		expect(res.id).toBe('z');
		expect(store.accounts).toHaveLength(0);
	});

	it('update error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'ue' }));
		const store = useCfAccountsStore();
		await expect(store.update('a', {})).rejects.toBeTruthy();
		expect(store.error).toBe('ue');
	});

	it('remove filters the account out', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([acct('a'), acct('b')]));
		const store = useCfAccountsStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ ok: true }));
		const res = await store.remove('a');
		expect(res.ok).toBe(true);
		expect(store.accounts.map((a) => a.id)).toEqual(['b']);
	});

	it('remove error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useCfAccountsStore();
		await expect(store.remove('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to remove account');
	});

	it('sync updates adapterCount in place', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([acct('a', { adapterCount: 1 })]));
		const store = useCfAccountsStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ finetunes: 3, adapterCount: 3 }));
		const res = await store.sync('a');
		expect(res.adapterCount).toBe(3);
		expect(store.accounts[0]!.adapterCount).toBe(3);
	});

	it('sync no-op when id missing does not throw', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ finetunes: 0, adapterCount: 0 }));
		const store = useCfAccountsStore();
		const res = await store.sync('missing');
		expect(res.adapterCount).toBe(0);
	});

	it('sync error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'se' }));
		const store = useCfAccountsStore();
		await expect(store.sync('a')).rejects.toBeTruthy();
		expect(store.error).toBe('se');
	});

	it('setDefault delegates to update with isDefault true', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([acct('a')]));
		const store = useCfAccountsStore();
		await store.fetch();
		const fetchMock = vi.fn().mockResolvedValue(acct('a', { isDefault: true }));
		vi.stubGlobal('$fetch', fetchMock);
		const res = await store.setDefault('a');
		expect(res.isDefault).toBe(true);
		expect(fetchMock.mock.calls[0]![1].body).toEqual({ isDefault: true });
	});

	it('available returns the accounts array', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ accounts: [acct('a')] }));
		const store = useCfAccountsStore();
		const res = await store.available();
		expect(res).toHaveLength(1);
	});

	it('preflight returns raw response', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ canPublish: true, detail: 'ok', tokenScope: 'edit' })
		);
		const store = useCfAccountsStore();
		const res = await store.preflight('a');
		expect(res.canPublish).toBe(true);
	});

	it('defaultAccount and totalSlotsUsed getters', async () => {
		vi.stubGlobal(
			'$fetch',
			vi
				.fn()
				.mockResolvedValue([
					acct('a', { adapterCount: 2 }),
					acct('b', { isDefault: true, adapterCount: 3 })
				])
		);
		const store = useCfAccountsStore();
		await store.fetch();
		expect(store.defaultAccount?.id).toBe('b');
		expect(store.totalSlotsUsed).toBe(5);
	});

	it('defaultAccount null when none default', () => {
		const store = useCfAccountsStore();
		expect(store.defaultAccount).toBeNull();
		expect(store.totalSlotsUsed).toBe(0);
	});
});
