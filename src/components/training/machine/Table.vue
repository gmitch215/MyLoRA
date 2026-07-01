<template>
	<div class="space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-muted max-w-prose">
				Private keys and passwords are envelope-encrypted at rest and never returned; only a public
				key and the last 4 characters are shown here.
			</p>
			<UButton
				icon="mdi:plus"
				@click="openCreate"
			>
				Add Machine
			</UButton>
		</div>

		<UTable
			:data="store.machines"
			:columns="columns"
			:loading="store.loading"
		>
			<template #label-cell="{ row }">
				<div class="flex items-center gap-2">
					<span class="font-medium text-highlighted">{{ row.original.label }}</span>
					<UBadge
						:color="row.original.shared ? 'info' : 'neutral'"
						variant="subtle"
						size="sm"
					>
						{{ row.original.shared ? 'shared' : 'personal' }}
					</UBadge>
				</div>
			</template>
			<template #host-cell="{ row }">
				<span class="font-mono text-muted">{{ row.original.host }}:{{ row.original.port }}</span>
			</template>
			<template #connectionType-cell="{ row }">
				<UBadge
					color="neutral"
					variant="outline"
					size="sm"
				>
					{{ row.original.connectionType === 'tunnel' ? 'tunnel' : 'vps' }}
				</UBadge>
			</template>
			<template #healthStatus-cell="{ row }">
				<div class="flex items-center gap-2">
					<AppSpinner
						v-if="autoTestingIds.has(row.original.id)"
						size="xs"
					/>
					<span
						v-if="autoTestingIds.has(row.original.id)"
						class="text-xs text-muted"
						>Checking...</span
					>
					<UBadge
						v-else
						:color="healthColor(row.original.healthStatus)"
						variant="subtle"
						size="sm"
					>
						{{ healthLabel(row.original.healthStatus) }}
					</UBadge>
				</div>
			</template>
			<template #gpu-cell="{ row }">
				<span
					v-if="row.original.gpuInfo"
					class="text-muted"
					>{{ row.original.gpuInfo.name }} -
					<template v-if="row.original.gpuInfo.vramUsedMb != null"
						>{{ formatVram(row.original.gpuInfo.vramUsedMb) }}/{{
							formatVram(row.original.gpuInfo.vramMb)
						}}</template
					>
					<template v-else>{{ formatVram(row.original.gpuInfo.vramMb) }}</template></span
				>
				<span
					v-else
					class="text-dimmed"
					>-</span
				>
			</template>
			<template #actions-cell="{ row }">
				<div class="flex items-center gap-1">
					<UButton
						icon="mdi:lan-connect"
						size="xs"
						variant="ghost"
						color="primary"
						title="Test Connection"
						aria-label="Test Connection"
						:loading="testingId === row.original.id"
						@click="onTest(row.original)"
					/>
					<UButton
						v-if="canManage(row.original)"
						icon="mdi:package-down"
						size="xs"
						variant="ghost"
						color="secondary"
						title="Prepare Dependencies"
						aria-label="Prepare Dependencies"
						@click="openPrepare(row.original)"
					/>
					<UButton
						v-if="canManage(row.original)"
						icon="mdi:pencil"
						size="xs"
						variant="ghost"
						color="neutral"
						title="Edit"
						aria-label="Edit"
						@click="openEdit(row.original)"
					/>
					<UButton
						v-if="canManage(row.original)"
						icon="mdi:key-change"
						size="xs"
						variant="ghost"
						color="warning"
						title="Rotate Key"
						aria-label="Rotate Key"
						:loading="rotatingId === row.original.id"
						@click="confirmRotate(row.original)"
					/>
					<UButton
						v-if="canManage(row.original)"
						icon="mdi:delete"
						size="xs"
						variant="ghost"
						color="error"
						title="Delete"
						aria-label="Delete"
						:loading="deletingId === row.original.id"
						@click="confirmRemove(row.original)"
					/>
				</div>
			</template>
		</UTable>

		<UModal
			v-model:open="formOpen"
			:title="editing ? 'Edit Machine' : 'Add Machine'"
			:dismissible="false"
			:close="false"
		>
			<template #body>
				<TrainingMachineForm
					:machine="editing ?? undefined"
					@submit="onFormSubmit"
					@cancel="formOpen = false"
				/>
			</template>
		</UModal>

		<UModal
			v-model:open="testOpen"
			title="Connection Test"
		>
			<template #body>
				<div class="space-y-4">
					<TrainingTestConnectionResult
						v-if="testResult"
						:diagnosis="testResult"
					/>
					<div class="flex flex-wrap justify-end gap-2">
						<UButton
							color="neutral"
							variant="outline"
							@click="testOpen = false"
						>
							Close
						</UButton>
					</div>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="rotateOpen"
			title="Rotate Key"
			:dismissible="false"
			:close="false"
		>
			<template #body>
				<div class="space-y-4">
					<template v-if="!rotatedKey">
						<p class="text-sm">
							Rotate the key for <strong>{{ pendingRotate?.label }}</strong
							>? The old key stops working immediately; you must install the new public key on the
							machine.
						</p>
						<div class="flex flex-wrap justify-end gap-2">
							<UButton
								color="neutral"
								variant="outline"
								@click="rotateOpen = false"
							>
								Cancel
							</UButton>
							<UButton
								icon="mdi:key-change"
								:loading="!!rotatingId"
								@click="doRotate"
							>
								Rotate Key
							</UButton>
						</div>
					</template>
					<template v-else>
						<UAlert
							color="success"
							variant="subtle"
							icon="mdi:key-variant"
							title="New Public Key"
							description="Install this on the machine now - you will not see it again."
						/>
						<div class="rounded-lg border border-default p-3 bg-elevated/50 space-y-2">
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-medium text-muted">Public Key</span>
								<UButton
									size="xs"
									color="neutral"
									variant="ghost"
									:icon="copied ? 'mdi:check' : 'mdi:content-copy'"
									title="Copy Public Key"
									aria-label="Copy Public Key"
									@click="copyKey"
								>
									{{ copied ? 'Copied' : 'Copy' }}
								</UButton>
							</div>
							<pre
								class="scrollbar-hide overflow-x-auto rounded bg-default/60 p-2 font-mono text-xs text-toned"
								>{{ rotatedKey }}</pre>
						</div>
						<div class="flex flex-wrap justify-end gap-2">
							<UButton @click="rotateOpen = false"> Done </UButton>
						</div>
					</template>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="prepareOpen"
			title="Prepare Dependencies"
		>
			<template #body>
				<div class="space-y-4">
					<p class="text-xs text-muted max-w-prose">
						Pre-download the training stack so jobs on this machine start fast (warms the package
						cache; no system changes).
					</p>
					<div
						v-if="pendingPrepare?.systemInfo?.prepared"
						class="flex items-center gap-2 text-xs text-muted"
					>
						<AppSpinner
							v-if="pendingPrepare.systemInfo.prepared.status === 'preparing'"
							size="xs"
						/>
						<span
							>Currently: {{ pendingPrepare.systemInfo.prepared.status }} - doc2lora[{{
								pendingPrepare.systemInfo.prepared.doc2loraExtras
							}}]{{
								pendingPrepare.systemInfo.prepared.torch
									? ', torch ' + pendingPrepare.systemInfo.prepared.torch
									: ''
							}}</span
						>
					</div>
					<UFormField label="Document Parsers">
						<USelect
							v-model="prepExtras"
							:items="prepExtrasItems"
							value-key="value"
							class="w-full"
						/>
					</UFormField>
					<USwitch
						v-model="prepLoad4bit"
						label="Include 4-bit (QLoRA)"
					/>
					<UFormField label="Python Version">
						<UInput
							v-model="prepPython"
							size="sm"
							class="font-mono"
						/>
					</UFormField>
					<UAlert
						v-if="prepExtras === 'all'"
						color="warning"
						variant="subtle"
						icon="mdi:alert"
						title="Audio + Video Needs Python <= 3.12"
						description="numba/llvmlite do not build on Python 3.13+; pick 3.12 or lower for the all preset."
					/>
					<div class="flex flex-wrap justify-end gap-2">
						<UButton
							color="neutral"
							variant="outline"
							@click="prepareOpen = false"
						>
							Cancel
						</UButton>
						<UButton
							icon="mdi:package-down"
							:loading="preparing"
							@click="doPrepare"
						>
							Prepare
						</UButton>
					</div>
				</div>
			</template>
		</UModal>

		<UModal
			v-model:open="confirmOpen"
			title="Delete Machine"
		>
			<template #body>
				<div class="space-y-4">
					<p class="text-sm">
						Delete <strong>{{ pendingDelete?.label }}</strong
						>? Jobs that reference it keep their history but cannot be retried.
					</p>
					<div class="flex flex-wrap justify-end gap-2">
						<UButton
							color="neutral"
							variant="outline"
							@click="confirmOpen = false"
						>
							Cancel
						</UButton>
						<UButton
							color="error"
							icon="mdi:delete"
							:loading="!!deletingId"
							@click="doRemove"
						>
							Delete
						</UButton>
					</div>
				</div>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
const { autoTestingIds = new Set<string>() } = defineProps<{
	// ids currently being auto-health-checked by the parent page
	autoTestingIds?: Set<string>;
}>();

const store = useMachinesStore();
const auth = useAuthStore();
const toast = useToast();

onMounted(() => {
	if (!store.machines.length) store.fetch();
});

const columns = [
	{ accessorKey: 'label', header: 'Label' },
	{ accessorKey: 'host', header: 'Host' },
	{ accessorKey: 'connectionType', header: 'Type' },
	{ accessorKey: 'healthStatus', header: 'Health' },
	{ accessorKey: 'gpu', header: 'GPU' },
	{ accessorKey: 'actions', header: '' }
];

const formOpen = ref(false);
const editing = ref<PublicMachine | null>(null);
const testingId = ref<string | null>(null);
const rotatingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);

const testOpen = ref(false);
const testResult = ref<ConnectionDiagnosis | null>(null);

const rotateOpen = ref(false);
const pendingRotate = ref<PublicMachine | null>(null);
const rotatedKey = ref<string | null>(null);
const copied = ref(false);

const prepareOpen = ref(false);
const pendingPrepare = ref<PublicMachine | null>(null);
const prepExtras = ref<'core' | 'docs' | 'all'>('docs');
const prepLoad4bit = ref(false);
const prepPython = ref('3.11');
const preparing = ref(false);
const prepExtrasItems = [
	{ label: 'Documents (Recommended)', value: 'docs' },
	{ label: 'Plain Text Only', value: 'core' },
	{ label: 'All (Adds Audio + Video)', value: 'all' }
];

const confirmOpen = ref(false);
const pendingDelete = ref<PublicMachine | null>(null);

// managers manage any machine; owners manage their own
function canManage(machine: PublicMachine) {
	if (auth.can('canManageMachines')) return true;
	return !!machine.ownerId && machine.ownerId === auth.user?.id;
}

function healthColor(h: MachineHealth) {
	if (h === 'ok') return 'success';
	if (h === 'degraded' || h === 'at_capacity') return 'warning';
	if (h === 'unreachable' || h === 'auth_failed') return 'error';
	if (h === 'running') return 'info';
	return 'neutral';
}
const HEALTH_LABELS: Record<MachineHealth, string> = {
	ok: 'OK',
	degraded: 'Degraded',
	unreachable: 'Unreachable',
	auth_failed: 'Auth Failed',
	unchecked: 'Unchecked',
	unknown: 'Unknown',
	running: 'Running',
	at_capacity: 'At Capacity'
};
function healthLabel(h: MachineHealth) {
	return HEALTH_LABELS[h] ?? 'Unchecked';
}

function formatVram(mb: number) {
	return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

function openCreate() {
	editing.value = null;
	formOpen.value = true;
}

function openEdit(machine: PublicMachine) {
	editing.value = machine;
	formOpen.value = true;
}

function onFormSubmit() {
	formOpen.value = false;
	editing.value = null;
}

async function onTest(machine: PublicMachine) {
	testingId.value = machine.id;
	try {
		const diagnosis = await store.test(machine.id);
		testResult.value = diagnosis;
		testOpen.value = true;
		toast.add({
			title: diagnosis.ok ? 'Connection OK' : 'Connection Failed',
			description: diagnosis.message,
			color: diagnosis.ok ? 'success' : 'error',
			icon: diagnosis.ok ? 'mdi:check' : 'mdi:alert'
		});
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Test failed', color: 'error', icon: 'mdi:alert' });
	} finally {
		testingId.value = null;
	}
}

function confirmRotate(machine: PublicMachine) {
	pendingRotate.value = machine;
	rotatedKey.value = null;
	rotateOpen.value = true;
}

async function doRotate() {
	if (!pendingRotate.value) return;
	rotatingId.value = pendingRotate.value.id;
	try {
		rotatedKey.value = await store.rotateKey(pendingRotate.value.id);
		toast.add({ title: 'Key rotated', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		toast.add({ title: e?.data?.message ?? 'Rotate failed', color: 'error', icon: 'mdi:alert' });
		rotateOpen.value = false;
	} finally {
		rotatingId.value = null;
	}
}

async function copyKey() {
	if (!rotatedKey.value) return;
	try {
		await navigator.clipboard.writeText(rotatedKey.value);
		copied.value = true;
		setTimeout(() => (copied.value = false), 1500);
	} catch {
		// clipboard may be blocked; user can still select the text
	}
}

function openPrepare(machine: PublicMachine) {
	pendingPrepare.value = machine;
	prepExtras.value = 'docs';
	prepLoad4bit.value = false;
	prepPython.value = '3.11';
	prepareOpen.value = true;
}

async function doPrepare() {
	if (!pendingPrepare.value) return;
	preparing.value = true;
	try {
		const message = await store.prepare(pendingPrepare.value.id, {
			doc2loraExtras: prepExtras.value,
			load4bit: prepLoad4bit.value,
			pythonVersion: prepPython.value
		});
		toast.add({ title: message, color: 'success', icon: 'mdi:check' });
		prepareOpen.value = false;
	} catch (e: any) {
		toast.add({
			title: e?.data?.message ?? 'Prepare failed',
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		preparing.value = false;
	}
}

function confirmRemove(machine: PublicMachine) {
	pendingDelete.value = machine;
	confirmOpen.value = true;
}

async function doRemove() {
	if (!pendingDelete.value) return;
	deletingId.value = pendingDelete.value.id;
	try {
		await store.remove(pendingDelete.value.id);
		toast.add({ title: 'Machine deleted', color: 'success', icon: 'mdi:check' });
		confirmOpen.value = false;
	} catch (e: any) {
		toast.add({
			title: e?.data?.statusMessage ?? e?.data?.message ?? 'Delete failed',
			color: 'error',
			icon: 'mdi:alert'
		});
	} finally {
		deletingId.value = null;
	}
}
</script>
