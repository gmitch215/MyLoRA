<template>
	<form
		class="space-y-4"
		@submit.prevent="onSubmit"
	>
		<UAlert
			color="info"
			variant="subtle"
			icon="mdi:information-outline"
			title="Runs On Your Machine"
		>
			<template #description>
				<p>
					MyLoRA copies the adapters to the machine over SSH and starts
					<span class="font-mono">vllm serve</span> there with LoRA enabled, behind a tunnel. A
					random API key is generated and vLLM refuses requests without it. The machine needs a GPU
					with enough memory for the base model.
				</p>
			</template>
		</UAlert>

		<UFormField
			label="Label"
			name="label"
		>
			<UInput
				v-model="state.label"
				placeholder="Llama 3 on paisley-park"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Machine"
			name="machineId"
		>
			<USelect
				v-model="state.machineId"
				:items="machineItems"
				placeholder="Choose a machine"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Base Model"
			name="baseModel"
			help="The HuggingFace repo vLLM loads. Adapters must have been trained on it."
		>
			<UInput
				v-model="state.baseModel"
				placeholder="meta-llama/Llama-3.1-8B-Instruct"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			label="Adapters"
			name="adapterIds"
			:help="
				adapterItems.length
					? 'Only adapters trained on this base model, with uploaded files, are listed'
					: 'No adapter matches this base model yet'
			"
		>
			<USelectMenu
				v-model="state.adapterIds"
				:items="adapterItems"
				value-key="value"
				multiple
				placeholder="Choose adapters"
				class="w-full"
			/>
		</UFormField>

		<div class="grid gap-4 sm:grid-cols-2">
			<UFormField
				label="Port"
				name="port"
			>
				<UInput
					v-model.number="state.port"
					type="number"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Max LoRA Rank"
				name="maxLoraRank"
			>
				<UInput
					v-model.number="state.maxLoraRank"
					type="number"
					class="w-full"
				/>
			</UFormField>
		</div>

		<UFormField
			label="Tunnel"
			name="tunnel"
			help="A missing tunnel tool is installed on first use unless the machine's settings turn installs off"
		>
			<USelect
				v-model="state.tunnel"
				:items="tunnelItems"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			v-if="state.tunnel === 'ngrok'"
			label="ngrok Token"
			name="ngrokToken"
			help="Add tokens under ngrok Tokens below. Automatic uses your default token, then the server token, then the machine's own sign in."
		>
			<USelect
				v-model="state.ngrokToken"
				:items="ngrokItems"
				class="w-full"
				aria-label="ngrok Token"
			/>
		</UFormField>

		<div
			v-if="state.tunnel === 'cloudflared'"
			class="grid gap-4 sm:grid-cols-2"
		>
			<UFormField
				label="Tunnel Token"
				name="tunnelToken"
				help="Leave blank for a free quick tunnel with a random hostname"
			>
				<UInput
					v-model="state.tunnelToken"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Public Hostname"
				name="hostname"
				help="Required with a token: the hostname the tunnel serves"
			>
				<UInput
					v-model="state.hostname"
					placeholder="vllm.example.com"
					class="w-full"
				/>
			</UFormField>
		</div>

		<UFormField
			label="HuggingFace Token"
			name="hfToken"
			help="Optional. Needed for gated models when the machine has no token of its own."
		>
			<UInput
				v-model="state.hfToken"
				type="password"
				autocomplete="new-password"
				class="w-full"
			/>
		</UFormField>

		<UFormField
			name="shared"
			description="Adapters served here can be tested by anyone who can see them, within the rate limits"
		>
			<USwitch
				v-model="state.shared"
				label="Shared"
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
				@click="emit('cancel')"
			>
				Cancel
			</UButton>
			<UButton
				type="submit"
				icon="mdi:rocket-launch"
				:loading="saving"
			>
				Start Server
			</UButton>
		</div>
	</form>
</template>

<script setup lang="ts">
type AdapterRow = Pick<
	Adapter,
	'id' | 'name' | 'baseModel' | 'rank' | 'weightsBytes' | 'configBytes'
>;

const emit = defineEmits<{ started: [endpoint: PublicEndpoint]; cancel: [] }>();

const store = useEndpointsStore();
const machines = useMachinesStore();
const ngrokStore = useNgrokTokensStore();
const saving = ref(false);
const error = ref('');

const state = reactive({
	label: '',
	machineId: '',
	baseModel: '',
	adapterIds: [] as string[],
	port: 8000,
	maxLoraRank: 32,
	tunnel: 'ngrok' as 'ngrok' | 'cloudflared',
	ngrokToken: 'auto',
	tunnelToken: '',
	hostname: '',
	hfToken: '',
	shared: false
});

const tunnelItems = [
	{ label: 'ngrok http', value: 'ngrok' },
	{ label: 'Cloudflare Tunnel (cloudflared)', value: 'cloudflared' }
];

const ngrokItems = computed(() => [
	{ label: 'Automatic', value: 'auto' },
	{ label: "The Machine's Own Sign In", value: 'machine' },
	...(ngrokStore.serverSecret ? [{ label: 'Server Token', value: 'server' }] : []),
	...ngrokStore.tokens.filter((t) => t.isActive).map((t) => ({ label: t.label, value: t.id }))
]);

const adapters = ref<AdapterRow[]>([]);
onMounted(async () => {
	ngrokStore.fetch().catch(() => {});
	if (!machines.machines.length) await machines.fetch().catch(() => {});
	try {
		const res = await $fetch<{ items: AdapterRow[] }>('/api/adapters/list', {
			query: { pageSize: 100, sort: 'newest' }
		});
		adapters.value = res.items ?? [];
	} catch {
		adapters.value = [];
	}
});

const machineItems = computed(() =>
	machines.machines
		.filter((m) => m.healthStatus !== 'unreachable')
		.map((m) => ({ label: m.label, value: m.id }))
);

// a server loads one base model, so only adapters trained on it can join
const adapterItems = computed(() =>
	adapters.value
		.filter(
			(a) =>
				a.weightsBytes > 0 &&
				a.configBytes > 0 &&
				hfModelFor(a.baseModel) === state.baseModel.trim()
		)
		.map((a) => ({ label: `${a.name} (rank ${a.rank})`, value: a.id }))
);

watch(
	() => state.baseModel,
	() => {
		const allowed = new Set(adapterItems.value.map((a) => a.value));
		state.adapterIds = state.adapterIds.filter((id) => allowed.has(id));
	}
);

async function onSubmit() {
	error.value = '';
	saving.value = true;
	try {
		const started = await store.startServe({
			label: state.label,
			machineId: state.machineId,
			baseModel: state.baseModel.trim(),
			adapterIds: state.adapterIds,
			port: Number(state.port) || 8000,
			maxLoraRank: Number(state.maxLoraRank) || 32,
			tunnel: state.tunnel,
			ngrokToken: state.ngrokToken,
			hostname: state.hostname.trim(),
			tunnelToken: state.tunnelToken,
			hfToken: state.hfToken,
			shared: state.shared
		});
		emit('started', started);
	} catch (e: any) {
		error.value = e?.data?.statusMessage || e?.statusMessage || 'Could not start the server';
	} finally {
		saving.value = false;
	}
}
</script>
