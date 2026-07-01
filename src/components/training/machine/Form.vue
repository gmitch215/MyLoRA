<template>
	<div class="space-y-4">
		<!-- view-once public key shown after a generated-key create -->
		<div
			v-if="generatedKey"
			class="space-y-4"
		>
			<UAlert
				color="success"
				variant="subtle"
				icon="mdi:check-circle"
				title="Machine Saved - One Last Step"
				description="MyLoRA created an SSH key for this machine and securely stored the private half. To let it connect, install the matching public key on the machine once, using the steps below."
			/>

			<!-- plain-language explainer for users new to ssh -->
			<div class="rounded-lg border border-default bg-elevated/30 p-3 text-xs text-muted space-y-1">
				<p>
					<span class="font-medium text-toned">What is this?</span> A public key is safe to share -
					it only lets MyLoRA log in, and cannot be used to read anything. MyLoRA already keeps the
					matching private key (encrypted); you never see or paste it.
				</p>
				<p>
					You only do this once. After the key is installed, MyLoRA connects automatically for every
					training run.
				</p>
			</div>

			<!-- numbered, copy-paste steps -->
			<ol class="space-y-3 text-sm">
				<li class="flex gap-2">
					<span class="text-primary font-semibold">1.</span>
					<span
						>Open a terminal <span class="text-muted">on the machine you are connecting to</span>
						and log in as
						<span class="font-mono text-toned">{{ state.username || 'your user' }}</span
						>.</span
					>
				</li>
				<li class="space-y-2">
					<div class="flex items-center justify-between gap-2">
						<span class="flex gap-2">
							<span class="text-primary font-semibold">2.</span>
							<span>Paste and run this one command (it adds the key and fixes permissions):</span>
						</span>
						<UButton
							size="xs"
							color="neutral"
							variant="ghost"
							:icon="copied ? 'mdi:check' : 'mdi:content-copy'"
							title="Copy Command"
							aria-label="Copy Command"
							@click="copyInstall"
						>
							{{ copied ? 'Copied' : 'Copy Command' }}
						</UButton>
					</div>
					<pre
						class="scrollbar-hide overflow-x-auto rounded bg-default/60 p-2 font-mono text-xs text-toned"
						>{{ installCommand }}</pre>
				</li>
				<li class="flex gap-2">
					<span class="text-primary font-semibold">3.</span>
					<span
						>Come back here and use <span class="font-medium text-toned">Test Connection</span> on
						this machine to confirm MyLoRA can log in.</span
					>
				</li>
			</ol>

			<UAlert
				color="warning"
				variant="subtle"
				icon="mdi:alert"
				title="Copy It Now"
				description="This key is shown only once. If you lose it before installing, use Rotate Key on the machine to generate a new one."
			/>

			<div class="flex flex-wrap justify-end gap-2">
				<UButton @click="emit('submit')"> Done </UButton>
			</div>
		</div>

		<UForm
			v-else
			:state="state"
			class="space-y-4"
			@submit="onSubmit"
		>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField
					label="Label"
					name="label"
				>
					<UInput
						v-model="state.label"
						placeholder="My GPU box"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Username"
					name="username"
					help="ssh login user"
				>
					<UInput
						v-model="state.username"
						placeholder="ubuntu"
						class="w-full font-mono"
					/>
				</UFormField>
			</div>

			<div class="grid gap-4 sm:grid-cols-3">
				<UFormField
					label="Host"
					name="host"
					class="sm:col-span-2"
					help="hostname or ip (for a tunnel, the ngrok forwarding host)"
				>
					<UInput
						v-model="state.host"
						placeholder="gpu.example.com"
						class="w-full font-mono"
					/>
				</UFormField>
				<UFormField
					label="Port"
					name="port"
				>
					<UInput
						v-model.number="state.port"
						type="number"
						:min="1"
						:max="65535"
						class="w-full"
					/>
				</UFormField>
			</div>

			<UFormField
				label="Connection Type"
				name="connectionType"
			>
				<USelect
					v-model="state.connectionType"
					:items="connectionTypeItems"
					value-key="value"
					class="w-full"
				/>
			</UFormField>

			<!-- branching guidance per connection type -->
			<UAlert
				v-if="state.connectionType === 'vps'"
				color="info"
				variant="subtle"
				icon="mdi:server-network"
				title="Public SSH Required"
				description="Open your SSH port (default 22) in the firewall and ensure the host is publicly reachable."
			/>
			<UAlert
				v-else
				color="neutral"
				variant="subtle"
				icon="mdi:vpn"
				title="ngrok Tunnel"
			>
				<template #description>
					Run <span class="font-mono">ngrok tcp &lt;ssh-port&gt;</span> on the machine and paste the
					forwarding host and port here. Run it as a service (systemd) so it survives reboot.
					Free-tier addresses change on restart - re-test or use the self-report script to
					auto-heal.
				</template>
			</UAlert>

			<UFormField
				label="Auth Method"
				name="authMethod"
			>
				<USelect
					v-model="authMethod"
					:items="authMethodItems"
					value-key="value"
					class="w-full"
				/>
			</UFormField>

			<!-- generated key: server makes an ed25519 pair, public key shown once on save -->
			<UAlert
				v-if="authMethod === 'generated'"
				color="info"
				variant="subtle"
				icon="mdi:key-plus"
				title="Generated Key"
				description="We generate an Ed25519 keypair and store the private key encrypted. After saving, the public key is shown once - install it in ~/.ssh/authorized_keys on the machine."
			/>

			<!-- paste an existing private key -->
			<template v-else-if="authMethod === 'provided'">
				<UFormField
					label="Private Key"
					name="privateKey"
					:help="isEdit ? 'Leave blank to keep the existing key' : 'PEM or OpenSSH private key'"
				>
					<UTextarea
						v-model="state.privateKey"
						:rows="6"
						:placeholder="isEdit ? '(unchanged)' : '-----BEGIN OPENSSH PRIVATE KEY-----'"
						class="w-full font-mono"
					/>
				</UFormField>
				<UFormField
					label="Passphrase"
					name="passphrase"
					help="Optional. Encrypted keys must be PKCS8 or OpenSSH aes256-ctr"
				>
					<UInput
						v-model="state.passphrase"
						type="password"
						autocomplete="off"
						:placeholder="isEdit ? '(unchanged)' : 'Key passphrase'"
						class="w-full"
					/>
				</UFormField>
			</template>

			<!-- password auth: discouraged -->
			<template v-else>
				<UAlert
					color="warning"
					variant="subtle"
					icon="mdi:shield-alert"
					title="Passwords Are Less Secure"
					description="Passwords are less secure than keys; prefer a generated key."
				/>
				<UFormField
					label="Password"
					name="password"
					:help="isEdit ? 'Leave blank to keep the existing password' : undefined"
				>
					<UInput
						v-model="state.password"
						type="password"
						autocomplete="off"
						:placeholder="isEdit ? '(unchanged)' : 'SSH password'"
						class="w-full"
					/>
				</UFormField>
			</template>

			<UFormField
				name="shared"
				class="flex-1"
			>
				<USwitch
					v-model="state.shared"
					label="Shared"
					description="Available to all trainers, not just you"
				/>
			</UFormField>

			<UAlert
				v-if="error"
				color="error"
				variant="subtle"
				icon="mdi:alert-circle"
				:title="error"
			/>

			<div class="flex flex-wrap justify-end gap-2">
				<UButton
					color="neutral"
					variant="outline"
					:disabled="loading || autoTesting"
					@click="emit('cancel')"
				>
					Cancel
				</UButton>
				<UButton
					type="submit"
					icon="mdi:content-save"
					:loading="loading || autoTesting"
				>
					{{ autoTesting ? 'Testing Connection' : isEdit ? 'Save Changes' : 'Add Machine' }}
				</UButton>
			</div>
		</UForm>
	</div>
</template>

<script setup lang="ts">
import type { FormSubmitEvent } from '#ui/types';

const props = defineProps<{ machine?: PublicMachine }>();
const emit = defineEmits<{ submit: [machine?: PublicMachine]; cancel: [] }>();

const store = useMachinesStore();
const toast = useToast();

const isEdit = computed(() => !!props.machine);

// ui-level auth selector: generated | provided | password
// (maps to server authMethod + keySource on submit)
type AuthChoice = 'generated' | 'provided' | 'password';
const initialAuthChoice: AuthChoice = props.machine
	? props.machine.authMethod === 'password'
		? 'password'
		: props.machine.keySource === 'provided'
			? 'provided'
			: 'generated'
	: 'generated';
const authMethod = ref<AuthChoice>(initialAuthChoice);

const state = reactive({
	label: props.machine?.label ?? '',
	host: props.machine?.host ?? '',
	port: props.machine?.port ?? 22,
	username: props.machine?.username ?? '',
	connectionType: props.machine?.connectionType ?? 'vps',
	shared: props.machine?.shared ?? false,
	// secrets are always blank in the form; blank keeps the stored value on edit
	privateKey: '',
	passphrase: '',
	password: ''
});

const connectionTypeItems = [
	{ label: 'VPS (Public Host)', value: 'vps' },
	{ label: 'Tunnel (ngrok)', value: 'tunnel' }
];
const authMethodItems = [
	{ label: 'Generated Key (Recommended)', value: 'generated' },
	{ label: 'Paste Private Key', value: 'provided' },
	{ label: 'Password', value: 'password' }
];

const loading = ref(false);
// true while an auto-test runs after a host/port edit (drives the save button spinner)
const autoTesting = ref(false);
const error = ref('');
const generatedKey = ref<string | null>(null);
const copied = ref(false);

// a single foolproof install line: make ~/.ssh if missing, append the key, fix perms
const installCommand = computed(
	() =>
		`mkdir -p ~/.ssh && echo "${generatedKey.value ?? ''}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
);

async function copyInstall() {
	try {
		await navigator.clipboard.writeText(installCommand.value);
		copied.value = true;
		setTimeout(() => (copied.value = false), 1500);
	} catch {
		// clipboard may be blocked; user can still select the text
	}
}

// re-test a machine after a host/port edit; surfaces the diagnosis like a manual test, never throws
async function runAutoTest(id: string) {
	autoTesting.value = true;
	try {
		const diagnosis = await store.test(id);
		toast.add({
			title: diagnosis.ok ? 'Connection OK' : 'Connection Failed',
			description: diagnosis.message,
			color: diagnosis.ok ? 'success' : 'error',
			icon: diagnosis.ok ? 'mdi:check' : 'mdi:alert'
		});
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Test failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		autoTesting.value = false;
	}
}

async function onSubmit(_event: FormSubmitEvent<any>) {
	loading.value = true;
	error.value = '';
	try {
		if (isEdit.value && props.machine) {
			const payload: Record<string, unknown> = {
				label: state.label,
				host: state.host,
				port: state.port,
				username: state.username,
				connectionType: state.connectionType,
				shared: state.shared
			};
			// only send a secret when the user typed one (blank keeps the stored value)
			if (authMethod.value === 'password') {
				if (state.password) payload.password = state.password;
			} else if (authMethod.value === 'provided') {
				if (state.privateKey) payload.privateKey = state.privateKey;
				if (state.passphrase) payload.passphrase = state.passphrase;
			}
			// capture the connection identity before the edit lands
			const prevHost = props.machine.host;
			const prevPort = props.machine.port;
			const machine = await store.update(props.machine.id, payload as MachineUpdateInput);
			toast.add({ title: 'Machine saved', color: 'success', icon: 'mdi:check' });
			// a host/port change invalidates the stored health; re-test automatically
			if (state.host !== prevHost || state.port !== prevPort) {
				await runAutoTest(props.machine.id);
			}
			emit('submit', machine);
		} else {
			const payload: MachineCreateInput = {
				label: state.label,
				host: state.host,
				port: state.port,
				username: state.username,
				connectionType: state.connectionType,
				shared: state.shared,
				authMethod: authMethod.value === 'password' ? 'password' : 'key',
				keySource: authMethod.value === 'provided' ? 'provided' : 'generated',
				privateKey: state.privateKey || undefined,
				passphrase: state.passphrase || undefined,
				password: state.password || undefined
			};
			const res = await store.create(payload);
			toast.add({ title: 'Machine added', color: 'success', icon: 'mdi:check' });
			// a generated key returns the public key once; hold the form open to show it
			if (res.publicKey) {
				generatedKey.value = res.publicKey;
			} else {
				emit('submit', res.machine);
			}
		}
	} catch (e: any) {
		error.value =
			e?.data?.statusMessage ?? e?.data?.message ?? e?.message ?? 'Failed to save machine';
	} finally {
		loading.value = false;
	}
}
</script>
