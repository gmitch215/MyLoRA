import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMachines } from '~/composables/useMachines';

const fetchMock = vi.fn();

const machine = (id: string, isActive = true) => ({ id, label: id, isActive }) as any;

beforeEach(() => {
	setActivePinia(createPinia());
	fetchMock.mockReset();
	vi.stubGlobal('$fetch', fetchMock);
});

describe('useMachines', () => {
	it('fetchMachines populates machines and clears loading', async () => {
		fetchMock.mockResolvedValue({ machines: [machine('m1'), machine('m2', false)] });
		const { machines, loading, fetchMachines } = useMachines();
		const res = await fetchMachines();
		expect(res).toHaveLength(2);
		expect(machines.value).toHaveLength(2);
		expect(loading.value).toBe(false);
	});

	it('usableMachines filters to active machines only', async () => {
		fetchMock.mockResolvedValue({ machines: [machine('a', true), machine('b', false)] });
		const { usableMachines, fetchMachines } = useMachines();
		await fetchMachines();
		expect(usableMachines.value.map((m: any) => m.id)).toEqual(['a']);
	});

	it('fetchMachines records the error message on failure', async () => {
		fetchMock.mockRejectedValue({ data: { message: 'boom' } });
		const { error, fetchMachines } = useMachines();
		await expect(fetchMachines()).rejects.toBeTruthy();
		expect(error.value).toBe('boom');
	});

	it('createMachine appends the returned machine', async () => {
		fetchMock.mockResolvedValue({ machine: machine('new'), publicKey: 'pk' });
		const { machines, createMachine } = useMachines();
		const res = await createMachine({ label: 'new' } as any);
		expect(res.publicKey).toBe('pk');
		expect(machines.value.map((m: any) => m.id)).toContain('new');
	});

	it('updateMachine replaces the matching machine', async () => {
		fetchMock.mockResolvedValueOnce({ machines: [machine('m1')] });
		const { machines, fetchMachines, updateMachine } = useMachines();
		await fetchMachines();
		fetchMock.mockResolvedValueOnce({ machine: { ...machine('m1'), label: 'renamed' } });
		const res = await updateMachine('m1', { label: 'renamed' } as any);
		expect(res.label).toBe('renamed');
		expect(machines.value[0].label).toBe('renamed');
	});

	it('removeMachine drops the machine from the list', async () => {
		fetchMock.mockResolvedValueOnce({ machines: [machine('m1'), machine('m2')] });
		const { machines, fetchMachines, removeMachine } = useMachines();
		await fetchMachines();
		fetchMock.mockResolvedValueOnce({ ok: true });
		await removeMachine('m1');
		expect(machines.value.map((m: any) => m.id)).toEqual(['m2']);
	});

	it('testMachine returns the diagnosis and patches the machine', async () => {
		fetchMock.mockResolvedValueOnce({ machines: [machine('m1')] });
		const { fetchMachines, testMachine } = useMachines();
		await fetchMachines();
		fetchMock.mockResolvedValueOnce({
			machine: machine('m1'),
			diagnosis: { ok: true }
		});
		const diag = await testMachine('m1');
		expect(diag).toEqual({ ok: true });
	});

	it('rotateKey returns the new public key', async () => {
		fetchMock.mockResolvedValueOnce({ machines: [machine('m1')] });
		const { fetchMachines, rotateKey } = useMachines();
		await fetchMachines();
		fetchMock.mockResolvedValueOnce({ machine: machine('m1'), publicKey: 'rotated' });
		const pk = await rotateKey('m1');
		expect(pk).toBe('rotated');
	});
});
