import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import PermissionMatrix from '~/components/settings/PermissionMatrix.vue';

function matrix(overrides: Record<string, any> = {}) {
	const cap = {
		canCreate: false,
		canEditOwn: false,
		canEditAny: false,
		canDeleteOwn: false,
		canDeleteAny: false,
		canPublish: false,
		canManageAccounts: false,
		canManageMachines: false,
		canTrain: false,
		unlimitedTester: false
	};
	return {
		developer: { ...cap },
		manager: { ...cap },
		administrator: { ...cap },
		...overrides
	} as any;
}

describe('settings/PermissionMatrix', () => {
	it('renders a row per capability with headers', async () => {
		const w = await mountSuspended(PermissionMatrix, { props: { modelValue: matrix() } });
		expect(w.text()).toContain('Create Adapters');
		expect(w.text()).toContain('Delete Any');
		expect(w.text()).toContain('Unlimited Testing');
		expect(w.text()).toContain('Developer');
		expect(w.text()).toContain('Manager');
		expect(w.text()).toContain('Administrator');
		// 10 capability rows
		expect(w.findAll('tbody tr')).toHaveLength(10);
	});

	it('emits an updated matrix when a developer switch toggles', async () => {
		const w = await mountSuspended(PermissionMatrix, { props: { modelValue: matrix() } });
		const switches = w.findAllComponents({ name: 'USwitch' });
		// first switch is developer/canCreate
		switches[0]!.vm.$emit('update:modelValue', true);
		await w.vm.$nextTick();
		const emitted = w.emitted('update:modelValue');
		expect(emitted).toBeTruthy();
		const payload = emitted![0]![0] as any;
		expect(payload.developer.canCreate).toBe(true);
		// other roles untouched
		expect(payload.manager.canCreate).toBe(false);
	});

	it('emits an updated matrix when a manager switch toggles', async () => {
		const w = await mountSuspended(PermissionMatrix, { props: { modelValue: matrix() } });
		const switches = w.findAllComponents({ name: 'USwitch' });
		// per row: [developer, manager, administrator(disabled)]; second switch is manager/canCreate
		switches[1]!.vm.$emit('update:modelValue', true);
		await w.vm.$nextTick();
		const payload = w.emitted('update:modelValue')![0]![0] as any;
		expect(payload.manager.canCreate).toBe(true);
		expect(payload.developer.canCreate).toBe(false);
	});

	it('reflects an existing granted capability in the switch model', async () => {
		const m = matrix();
		m.developer.canPublish = true;
		const w = await mountSuspended(PermissionMatrix, { props: { modelValue: m } });
		// find the canPublish row and its developer switch is on
		const switches = w.findAllComponents({ name: 'USwitch' });
		// canPublish is the 6th capability (index 5); developer switch index = 5*3
		expect(switches[15]!.props('modelValue')).toBe(true);
	});
});
