import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMachinesStore } from '~/stores/machines';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function machine(id: string, extra: Record<string, unknown> = {}) {
	return { id, name: id, isActive: true, ...extra } as any;
}

describe('machines store', () => {
	it('fetch loads machines from wrapped response', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [machine('a')] }));
		const store = useMachinesStore();
		const res = await store.fetch();
		expect(res).toHaveLength(1);
		expect(store.machines).toHaveLength(1);
		expect(store.loading).toBe(false);
	});

	it('fetch error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'fe' } }));
		const store = useMachinesStore();
		await expect(store.fetch()).rejects.toBeTruthy();
		expect(store.error).toBe('fe');
		expect(store.loading).toBe(false);
	});

	it('create pushes new machine and returns full response', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ machine: machine('n'), publicKey: 'ssh-key' })
		);
		const store = useMachinesStore();
		const res = await store.create({ name: 'n' } as any);
		expect(res.publicKey).toBe('ssh-key');
		expect(store.machines.map((m) => m.id)).toEqual(['n']);
	});

	it('create error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useMachinesStore();
		await expect(store.create({} as any)).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to create machine');
	});

	it('update patches machine in place and returns machine', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [machine('a')] }));
		const store = useMachinesStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machine: machine('a', { name: 'r' }) }));
		const res = await store.update('a', { name: 'r' } as any);
		expect(res.name).toBe('r');
		expect(store.machines[0]!.name).toBe('r');
	});

	it('update no-op when id missing', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machine: machine('z') }));
		const store = useMachinesStore();
		const res = await store.update('z', {} as any);
		expect(res.id).toBe('z');
		expect(store.machines).toHaveLength(0);
	});

	it('update error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'ue' }));
		const store = useMachinesStore();
		await expect(store.update('a', {} as any)).rejects.toBeTruthy();
		expect(store.error).toBe('ue');
	});

	it('remove filters machine out', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [machine('a'), machine('b')] }));
		const store = useMachinesStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ ok: true }));
		const res = await store.remove('a');
		expect(res.ok).toBe(true);
		expect(store.machines.map((m) => m.id)).toEqual(['b']);
	});

	it('remove error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useMachinesStore();
		await expect(store.remove('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to remove machine');
	});

	it('test returns diagnosis and patches machine', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [machine('a')] }));
		const store = useMachinesStore();
		await store.fetch();
		vi.stubGlobal(
			'$fetch',
			vi
				.fn()
				.mockResolvedValue({ machine: machine('a', { isActive: false }), diagnosis: { ok: false } })
		);
		const res = await store.test('a');
		expect(res).toEqual({ ok: false });
		expect(store.machines[0]!.isActive).toBe(false);
	});

	it('test error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'te' }));
		const store = useMachinesStore();
		await expect(store.test('a')).rejects.toBeTruthy();
		expect(store.error).toBe('te');
	});

	it('rotateKey returns publicKey and patches machine', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [machine('a')] }));
		const store = useMachinesStore();
		await store.fetch();
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ machine: machine('a', { rotated: true }), publicKey: 'newkey' })
		);
		const res = await store.rotateKey('a');
		expect(res).toBe('newkey');
		expect((store.machines[0] as any).rotated).toBe(true);
	});

	it('rotateKey error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useMachinesStore();
		await expect(store.rotateKey('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to rotate key');
	});

	it('prepare returns message and patches machine', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [machine('a')] }));
		const store = useMachinesStore();
		await store.fetch();
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ machine: machine('a', { prepared: true }), message: 'queued' })
		);
		const res = await store.prepare('a', { doc2loraExtras: 'all' });
		expect(res).toBe('queued');
		expect((store.machines[0] as any).prepared).toBe(true);
	});

	it('prepare error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'pe' }));
		const store = useMachinesStore();
		await expect(store.prepare('a', { doc2loraExtras: 'core' })).rejects.toBeTruthy();
		expect(store.error).toBe('pe');
	});

	it('usableMachines filters inactive out', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ machines: [machine('a'), machine('b', { isActive: false })] })
		);
		const store = useMachinesStore();
		await store.fetch();
		expect(store.usableMachines.map((m) => m.id)).toEqual(['a']);
	});
});
