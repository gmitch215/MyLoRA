<template>
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<UFormField
			label="Install Missing Tools"
			help="When off, the serve job uses only what is already on the machine"
		>
			<USelect
				v-model="autoInstall"
				:items="autoInstallItems"
				class="w-full"
				aria-label="Install Missing Tools"
			/>
		</UFormField>
		<UFormField
			label="Python Version"
			help="The managed Python uv creates for vLLM"
		>
			<UInput
				v-model="pythonVersion"
				:placeholder="shown.pythonVersion"
				class="w-full font-mono"
			/>
		</UFormField>
		<UFormField
			label="vLLM Version"
			help="Installed as vllm==version, so a new release never changes a machine by itself"
		>
			<UInput
				v-model="vllmVersion"
				:placeholder="shown.vllmVersion"
				class="w-full font-mono"
			/>
		</UFormField>
		<UFormField
			label="cloudflared Version"
			help="Installed only when the machine has none; checked against the release checksum"
		>
			<UInput
				v-model="cloudflaredVersion"
				:placeholder="shown.cloudflaredVersion"
				class="w-full font-mono"
			/>
		</UFormField>
		<UFormField
			label="Download Attempts"
			:help="`${TOOLING_RANGES.downloadRetries.min}-${TOOLING_RANGES.downloadRetries.max} tries per download, with growing pauses`"
		>
			<UInput
				v-model.number="downloadRetries"
				type="number"
				:min="TOOLING_RANGES.downloadRetries.min"
				:max="TOOLING_RANGES.downloadRetries.max"
				:placeholder="String(shown.downloadRetries)"
				class="w-full"
			/>
		</UFormField>
		<UFormField
			label="Network Wait (Minutes)"
			:help="`How long to wait for a dropped connection to return (${TOOLING_RANGES.networkWaitMinutes.min}-${TOOLING_RANGES.networkWaitMinutes.max}); 0 fails at once`"
		>
			<UInput
				v-model.number="networkWaitMinutes"
				type="number"
				:min="TOOLING_RANGES.networkWaitMinutes.min"
				:max="TOOLING_RANGES.networkWaitMinutes.max"
				:placeholder="String(shown.networkWaitMinutes)"
				class="w-full"
			/>
		</UFormField>
		<UFormField
			label="Bandwidth Limit (kB/s)"
			help="0 is unlimited. Caps the tool downloads and runs one package and model download at a time"
		>
			<UInput
				v-model.number="bandwidthLimitKbps"
				type="number"
				:min="TOOLING_RANGES.bandwidthLimitKbps.min"
				:max="TOOLING_RANGES.bandwidthLimitKbps.max"
				:placeholder="String(shown.bandwidthLimitKbps)"
				class="w-full"
			/>
		</UFormField>
	</div>
</template>

<script setup lang="ts">
// with inherit set, a blank field means "use the settings"; without it every field is a value
const props = defineProps<{ modelValue: MachineTooling; inherit?: ToolingSettings }>();
const emit = defineEmits<{ 'update:modelValue': [value: MachineTooling] }>();

const shown = computed(() => props.inherit ?? DEFAULT_TOOLING);

function bind<K extends keyof ToolingSettings>(key: K) {
	return computed({
		get: () => props.modelValue[key] ?? '',
		set: (value: unknown) => {
			const next: Record<string, unknown> = { ...props.modelValue };
			if (value === '' || value === null || value === undefined) delete next[key];
			else next[key] = value;
			emit('update:modelValue', next as MachineTooling);
		}
	});
}

const pythonVersion = bind('pythonVersion');
const vllmVersion = bind('vllmVersion');
const cloudflaredVersion = bind('cloudflaredVersion');
const downloadRetries = bind('downloadRetries');
const networkWaitMinutes = bind('networkWaitMinutes');
const bandwidthLimitKbps = bind('bandwidthLimitKbps');

const inheritLabel = computed(() =>
	props.inherit ? `Use Settings (${props.inherit.autoInstall ? 'On' : 'Off'})` : null
);
const autoInstallItems = computed(() => [
	...(inheritLabel.value ? [{ label: inheritLabel.value, value: 'inherit' }] : []),
	{ label: 'On', value: 'on' },
	{ label: 'Off', value: 'off' }
]);
const autoInstall = computed({
	get: () => {
		const v = props.modelValue.autoInstall;
		return v === undefined ? (props.inherit ? 'inherit' : 'on') : v ? 'on' : 'off';
	},
	set: (value: string) => {
		const next: Record<string, unknown> = { ...props.modelValue };
		if (value === 'inherit') delete next.autoInstall;
		else next.autoInstall = value === 'on';
		emit('update:modelValue', next as MachineTooling);
	}
});
</script>
