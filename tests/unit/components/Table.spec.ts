import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MachineTable from '~/components/training/machine/Table.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function machine(overrides: Record<string, any> = {}): any {
	return {
		id: 'm1',
		label: 'GPU Box',
		host: 'gpu.example.com',
		port: 22,
		username: 'ubuntu',
		authMethod: 'key',
		connectionType: 'vps',
		keySource: 'generated',
		healthStatus: 'ok',
		toolingReady: true,
		hasSelfReport: false,
		isActive: true,
		shared: false,
		ownerId: 'u1',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

async function flush() {
	await new Promise((r) => setTimeout(r, 0));
}

// NOTE: mountSuspended reuses one nuxt-app pinia across mounts in this file, and the
// component only fetches when the store is empty. so the first mount seeds an empty
// store, then the comprehensive rows test (running next) is the one that populates it.

describe('training/machine/Table', () => {
	it('renders the header note and add button on an empty machine list', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [] }));
		const w = await mountSuspended(MachineTable);
		expect(w.text()).toContain('Add Machine');
		expect(w.text()).toContain('envelope-encrypted');
		vi.unstubAllGlobals();
	});

	it('renders rows with host, type, health, gpu and shared badges across statuses', async () => {
		const statuses: Record<string, string> = {
			ok: 'OK',
			degraded: 'Degraded',
			unreachable: 'Unreachable',
			auth_failed: 'Auth Failed',
			unchecked: 'Unchecked',
			running: 'Running',
			at_capacity: 'At Capacity'
		};
		const rows = Object.keys(statuses).map((h, i) =>
			machine({
				id: `m${i}`,
				label: `M${i}`,
				healthStatus: h,
				connectionType: i === 0 ? 'tunnel' : 'vps',
				shared: i === 0,
				gpuInfo: i === 0 ? { name: 'RTX 4090', vramMb: 24576, vramUsedMb: 1024 } : null
			})
		);
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: rows }));
		const w = await mountSuspended(MachineTable);
		await flush();
		await w.vm.$nextTick();
		const text = w.text();
		// host + port formatting
		expect(text).toContain('gpu.example.com:22');
		// connection type badges
		expect(text).toContain('tunnel');
		expect(text).toContain('vps');
		// shared badge
		expect(text).toContain('shared');
		// gpu name + vram used/total
		expect(text).toContain('RTX 4090');
		// every health label maps through
		for (const label of Object.values(statuses)) {
			expect(text).toContain(label);
		}
		vi.unstubAllGlobals();
	});

	it('opens the create modal from Add Machine', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [] }));
		const w = await mountSuspended(MachineTable);
		const addBtn = w.findAll('button').find((b) => b.text().includes('Add Machine'));
		await addBtn!.trigger('click');
		await w.vm.$nextTick();
		await flush();
		// modal teleports its body to document; the machine form renders there
		expect(document.body.textContent).toContain('Add Machine');
		vi.unstubAllGlobals();
	});
});
