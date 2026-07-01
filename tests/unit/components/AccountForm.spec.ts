import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountForm from '~/components/cloudflare/AccountForm.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function account(overrides: Record<string, any> = {}): any {
	return {
		id: 'a1',
		label: 'Prod',
		accountId: 'abcdef0123456789abcdef0123456789',
		tokenScope: 'readwrite',
		tokenLast4: 'wxyz',
		shared: false,
		isDefault: false,
		adapterCount: 0,
		...overrides
	};
}

describe('cloudflare/AccountForm', () => {
	it('renders the create form with the Add Account submit label', async () => {
		const w = await mountSuspended(AccountForm);
		expect(w.text()).toContain('Add Account');
		expect(w.text()).toContain('Tokens Are Encrypted');
		// create mode: no publish-permission check button
		expect(w.text()).not.toContain('Check Publish Permission');
	});

	it('prefills the state and shows edit-mode controls', async () => {
		const w = await mountSuspended(AccountForm, { props: { account: account() } });
		expect(w.text()).toContain('Save Changes');
		expect(w.text()).toContain('Check Publish Permission');
		// account id input is disabled on edit
		const idInput = w
			.findAll('input')
			.find((i) => (i.element as HTMLInputElement).value === account().accountId);
		expect(idInput).toBeTruthy();
	});

	it('emits cancel when the cancel button is clicked', async () => {
		const w = await mountSuspended(AccountForm);
		const cancel = w.findAll('button').find((b) => b.text().trim() === 'Cancel');
		await cancel!.trigger('click');
		expect(w.emitted('cancel')).toBeTruthy();
	});

	it('shows the can-publish alert after a successful preflight', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ canPublish: true, detail: 'ok' }));
		const w = await mountSuspended(AccountForm, { props: { account: account() } });
		const checkBtn = w.findAll('button').find((b) => b.text().includes('Check Publish Permission'));
		await checkBtn!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		expect(w.text()).toContain('Can Publish');
		vi.unstubAllGlobals();
	});

	it('shows the no-permission alert when preflight denies publishing', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ canPublish: false, detail: 'scope too low.' })
		);
		const w = await mountSuspended(AccountForm, { props: { account: account() } });
		const checkBtn = w.findAll('button').find((b) => b.text().includes('Check Publish Permission'));
		await checkBtn!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		expect(w.text()).toContain('No Publish Permission');
		vi.unstubAllGlobals();
	});

	it('shows the unknown alert when preflight throws', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'network down' } }));
		const w = await mountSuspended(AccountForm, { props: { account: account() } });
		const checkBtn = w.findAll('button').find((b) => b.text().includes('Check Publish Permission'));
		await checkBtn!.trigger('click');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		expect(w.text()).toContain('Unknown');
		vi.unstubAllGlobals();
	});
});
