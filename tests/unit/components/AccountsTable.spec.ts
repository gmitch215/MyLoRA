import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountsTable from '~/components/cloudflare/AccountsTable.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function acct(id: string, extra: Record<string, unknown> = {}): any {
	return {
		id,
		label: id,
		accountId: 'abcdef0123456789abcdef0123456789',
		tokenScope: 'readwrite',
		tokenLast4: 'ab12',
		shared: false,
		isDefault: false,
		adapterCount: 0,
		...extra
	};
}

async function flush() {
	await new Promise((r) => setTimeout(r, 0));
}

describe('cloudflare/AccountsTable', () => {
	it('renders the header actions and encryption note', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([]));
		const w = await mountSuspended(AccountsTable);
		expect(w.text()).toContain('Add Account');
		expect(w.text()).toContain('envelope encryption');
		vi.unstubAllGlobals();
	});

	it('renders account rows with scope, type and default badges', async () => {
		// onMounted fetches; the stub seeds one readonly + shared + default account
		vi.stubGlobal(
			'$fetch',
			vi
				.fn()
				.mockResolvedValue([
					acct('main', { isDefault: true, shared: true, tokenScope: 'readonly' })
				])
		);
		const w = await mountSuspended(AccountsTable);
		await flush();
		await w.vm.$nextTick();
		const text = w.text();
		expect(text).toContain('main');
		expect(text).toContain('Read Only');
		expect(text).toContain('shared');
		expect(text).toContain('default');
		vi.unstubAllGlobals();
	});

	it('opens the create modal from Add Account', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([]));
		const w = await mountSuspended(AccountsTable);
		const addBtn = w.findAll('button').find((b) => b.text().includes('Add Account'));
		await addBtn!.trigger('click');
		await w.vm.$nextTick();
		await flush();
		// modal teleports its body; the account form renders there
		expect(document.body.textContent).toContain('Add Cloudflare Account');
		vi.unstubAllGlobals();
	});

	it('renders the publish badge after a successful verify', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([acct('main')]));
		const w = await mountSuspended(AccountsTable);
		await flush();
		await w.vm.$nextTick();
		// drive a verify success so the publish badge renders
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ canPublish: true, detail: 'ok' }));
		const verifyBtn = w
			.findAll('button')
			.find((b) => b.attributes('title') === 'Verify Publish Permission');
		await verifyBtn!.trigger('click');
		await flush();
		await w.vm.$nextTick();
		expect(w.text()).toContain('Can Publish');
		vi.unstubAllGlobals();
	});
});
