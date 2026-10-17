import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MachineForm from '~/components/training/machine/Form.vue';
import { DEFAULT_TOOLING } from '~/shared/defaults';

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
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

describe('training/machine/Form', () => {
	it('renders the create form with the generated-key guidance and Add Machine label', async () => {
		const w = await mountSuspended(MachineForm);
		expect(w.text()).toContain('Add Machine');
		// default auth is generated
		expect(w.text()).toContain('Generated Key');
		// vps connection type is the default -> public ssh alert
		expect(w.text()).toContain('Public SSH Required');
	});

	it('shows the private-key textarea for the provided auth method', async () => {
		const w = await mountSuspended(MachineForm, {
			props: { machine: machine({ authMethod: 'key', keySource: 'provided' }) }
		});
		expect(w.text()).toContain('Save Changes');
		expect(w.text()).toContain('Private Key');
		expect(w.text()).toContain('Passphrase');
	});

	it('shows the password warning for the password auth method', async () => {
		const w = await mountSuspended(MachineForm, {
			props: { machine: machine({ authMethod: 'password', keySource: null }) }
		});
		expect(w.text()).toContain('Passwords Are Less Secure');
	});

	it('renders the tunnel guidance when connection type is tunnel', async () => {
		const w = await mountSuspended(MachineForm, {
			props: { machine: machine({ connectionType: 'tunnel' }) }
		});
		expect(w.text()).toContain('ngrok Tunnel');
	});

	it('shows the serve tooling overrides, filled from the machine and inheriting the settings', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ tooling: DEFAULT_TOOLING }));
		const w = await mountSuspended(MachineForm, {
			props: { machine: machine({ tooling: { vllmVersion: '0.30.0' } }) }
		});
		expect(w.text()).toContain('Serve Tooling Overrides');
		const tooling = w.findComponent({ name: 'ToolingFields' });
		expect(tooling.props('modelValue')).toEqual({ vllmVersion: '0.30.0' });
		expect(tooling.props('inherit')).toBeTruthy();
		vi.unstubAllGlobals();
	});

	it('sends the overrides on save, and null once they are all cleared', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ machine: machine() });
		vi.stubGlobal('$fetch', fetchMock);
		const w = await mountSuspended(MachineForm, {
			props: { machine: machine({ tooling: { vllmVersion: '0.30.0' } }) }
		});
		const form = w.findComponent({ name: 'UForm' });
		await form.trigger('submit');
		await new Promise((r) => setTimeout(r, 0));
		const patch = () =>
			fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH').at(-1)![1].body;
		expect(patch().tooling).toEqual({ vllmVersion: '0.30.0' });

		w.findComponent({ name: 'ToolingFields' }).vm.$emit('update:modelValue', {});
		await w.vm.$nextTick();
		await form.trigger('submit');
		await new Promise((r) => setTimeout(r, 0));
		expect(patch().tooling).toBeNull();
		vi.unstubAllGlobals();
	});

	it('leaves tooling out of a create that set no overrides', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ machine: machine() });
		vi.stubGlobal('$fetch', fetchMock);
		const w = await mountSuspended(MachineForm);
		await w.findComponent({ name: 'UForm' }).trigger('submit');
		await new Promise((r) => setTimeout(r, 0));
		const create = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
		expect(create[1].body.tooling).toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('emits cancel when cancel is clicked', async () => {
		const w = await mountSuspended(MachineForm);
		const cancel = w.findAll('button').find((b) => b.text().trim() === 'Cancel');
		await cancel!.trigger('click');
		expect(w.emitted('cancel')).toBeTruthy();
	});

	it('shows the one-time public-key install view after a generated-key create', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ machine: machine(), publicKey: 'ssh-ed25519 AAAA...' })
		);
		const w = await mountSuspended(MachineForm);
		const form = w.findComponent({ name: 'UForm' });
		await form.trigger('submit');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		// generatedKey set -> the install instructions view renders
		expect(w.text()).toContain('Machine Saved - One Last Step');
		expect(w.text()).toContain('~/.ssh/authorized_keys');
		vi.unstubAllGlobals();
	});

	it('emits submit directly when a create returns no public key', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machine: machine() }));
		const w = await mountSuspended(MachineForm, {
			props: { machine: undefined }
		});
		const form = w.findComponent({ name: 'UForm' });
		await form.trigger('submit');
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		expect(w.emitted('submit')).toBeTruthy();
		vi.unstubAllGlobals();
	});
});
