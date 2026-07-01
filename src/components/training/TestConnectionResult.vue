<template>
	<div class="space-y-2">
		<div class="flex items-start gap-2">
			<UIcon
				:name="icon"
				:class="iconClass"
				class="mt-0.5 size-5 shrink-0"
			/>
			<div class="min-w-0 space-y-1">
				<p class="text-sm font-medium text-highlighted">{{ codeLabel }}</p>
				<p class="text-xs text-muted wrap-break-word">{{ diagnosis.message }}</p>
			</div>
		</div>

		<div
			v-if="diagnosis.gpuInfo || diagnosis.toolingReady !== undefined"
			class="flex flex-wrap gap-2 pl-7"
		>
			<UBadge
				v-if="diagnosis.gpuInfo"
				color="info"
				variant="subtle"
				size="sm"
				icon="mdi:expansion-card"
			>
				{{ diagnosis.gpuInfo.name }} - {{ formatVram(diagnosis.gpuInfo.vramMb) }}
			</UBadge>
			<UBadge
				v-if="diagnosis.toolingReady !== undefined"
				:color="diagnosis.toolingReady ? 'success' : 'warning'"
				variant="subtle"
				size="sm"
				:icon="diagnosis.toolingReady ? 'mdi:check' : 'mdi:wrench'"
			>
				{{ diagnosis.toolingReady ? 'Tooling Ready' : 'Tooling Missing' }}
			</UBadge>
		</div>

		<template v-if="sys">
			<div class="flex flex-wrap gap-2 pl-7">
				<UBadge
					v-if="sys.os"
					color="neutral"
					variant="subtle"
					size="sm"
					:icon="osIcon"
				>
					{{ sys.os }}
				</UBadge>
				<UBadge
					v-if="sys.cpuCores != null"
					color="neutral"
					variant="subtle"
					size="sm"
					icon="mdi:cpu-64-bit"
				>
					{{ sys.cpuCores }} Cores
				</UBadge>
				<UBadge
					v-if="sys.ramTotalMb != null"
					color="neutral"
					variant="subtle"
					size="sm"
					icon="mdi:memory"
				>
					<template v-if="sys.ramAvailMb != null"
						>{{ gb(sys.ramAvailMb) }}/{{ gb(sys.ramTotalMb) }} GB RAM</template
					>
					<template v-else>{{ gb(sys.ramTotalMb) }} GB RAM</template>
				</UBadge>
				<UBadge
					v-if="sys.diskTotalGb != null"
					color="neutral"
					variant="subtle"
					size="sm"
					icon="mdi:harddisk"
				>
					<template v-if="sys.diskAvailGb != null">{{ sys.diskAvailGb }}/</template
					>{{ sys.diskTotalGb }} GB{{ sys.diskType ? ` ${sys.diskType}` : '' }}
				</UBadge>
				<UBadge
					v-if="sys.gpus && sys.gpus.length > 1"
					color="info"
					variant="subtle"
					size="sm"
					icon="mdi:expansion-card-variant"
				>
					{{ sys.gpus.length }} GPUs
				</UBadge>
			</div>

			<dl class="ml-7 space-y-1 rounded-lg border border-default bg-elevated/30 p-3 text-xs">
				<div
					v-if="sys.hostname"
					class="flex items-center justify-between gap-4"
				>
					<dt class="text-muted">Host</dt>
					<dd class="font-mono text-toned wrap-break-word">{{ sys.hostname }}</dd>
				</div>
				<div
					v-if="sys.user"
					class="flex items-center justify-between gap-4"
				>
					<dt class="text-muted">User</dt>
					<dd class="font-mono text-toned wrap-break-word">{{ sys.user }}</dd>
				</div>
				<div
					v-if="sys.os"
					class="flex items-center justify-between gap-4"
				>
					<dt class="text-muted">OS</dt>
					<dd class="text-toned wrap-break-word">{{ sys.os }}</dd>
				</div>
				<div
					v-if="sys.kernel"
					class="flex items-center justify-between gap-4"
				>
					<dt class="text-muted">Kernel</dt>
					<dd class="font-mono text-toned wrap-break-word">{{ sys.kernel }}</dd>
				</div>
				<div
					v-if="sys.cpuModel"
					class="flex items-center justify-between gap-4"
				>
					<dt class="text-muted">CPU</dt>
					<dd class="text-toned wrap-break-word">{{ sys.cpuModel }}</dd>
				</div>
				<div
					v-for="(gpu, i) in sys.gpus ?? []"
					:key="i"
					class="flex items-center justify-between gap-4"
				>
					<dt class="text-muted">{{ gpu.name }}</dt>
					<dd class="text-toned">
						<template v-if="gpu.vramUsedMb != null"
							>{{ formatVram(gpu.vramUsedMb) }}/{{ formatVram(gpu.vramMb) }}</template
						>
						<template v-else>{{ formatVram(gpu.vramMb) }}</template>
						VRAM
					</dd>
				</div>
			</dl>
		</template>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ diagnosis: ConnectionDiagnosis }>();

// per-code icon + color; ok is the only success, the rest are warning/error
const CODE_META: Record<
	ConnectionDiagnosis['code'],
	{ label: string; icon: string; tone: 'success' | 'error' | 'warning' }
> = {
	ok: { label: 'Connection OK', icon: 'mdi:check-circle', tone: 'success' },
	dns: { label: 'DNS Resolution Failed', icon: 'mdi:dns', tone: 'error' },
	refused: { label: 'Connection Refused', icon: 'mdi:lan-disconnect', tone: 'error' },
	timeout: { label: 'Connection Timed Out', icon: 'mdi:timer-alert', tone: 'warning' },
	auth: { label: 'Authentication Failed', icon: 'mdi:key-alert', tone: 'error' },
	host_key_changed: {
		label: 'Host Key Changed',
		icon: 'mdi:shield-alert',
		tone: 'warning'
	},
	protocol: { label: 'Protocol Error', icon: 'mdi:alert-octagon', tone: 'error' },
	unknown: { label: 'Connection Failed', icon: 'mdi:help-circle', tone: 'error' }
};

const meta = computed(() => CODE_META[props.diagnosis.code] ?? CODE_META.unknown);
const codeLabel = computed(() => meta.value.label);
const icon = computed(() => meta.value.icon);
const iconClass = computed(() =>
	meta.value.tone === 'success'
		? 'text-success'
		: meta.value.tone === 'warning'
			? 'text-warning'
			: 'text-error'
);

const sys = computed(() => props.diagnosis.systemInfo);

// pick distro icon when the os string looks like ubuntu
const osIcon = computed(() =>
	sys.value?.os && /ubuntu/i.test(sys.value.os) ? 'mdi:ubuntu' : 'mdi:linux'
);

function formatVram(mb: number) {
	return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

// whole-gb for ram totals shown as a number before the unit
function gb(mb: number) {
	return (mb / 1024).toFixed(0);
}
</script>
