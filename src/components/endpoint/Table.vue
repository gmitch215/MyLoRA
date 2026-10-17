<template>
	<div class="space-y-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="max-w-prose text-xs text-muted">
				Keys are envelope-encrypted at rest and never returned; only the last 4 characters are
				shown. Adapters served from an endpoint skip Cloudflare entirely.
			</p>
			<div class="flex flex-wrap gap-2">
				<UButton
					icon="mdi:rocket-launch"
					color="primary"
					@click="serveOpen = true"
				>
					Serve With vLLM
				</UButton>
				<UButton
					icon="mdi:plus"
					variant="outline"
					@click="openCreate"
				>
					Add Endpoint
				</UButton>
			</div>
		</div>

		<UTable
			:data="store.endpoints"
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
					<UBadge
						color="neutral"
						variant="outline"
						size="sm"
					>
						{{ row.original.source === 'vllm' ? 'vllm' : 'external' }}
					</UBadge>
				</div>
			</template>
			<template #baseUrl-cell="{ row }">
				<span
					v-if="row.original.baseUrl"
					class="block max-w-64 truncate font-mono text-muted"
					>{{ row.original.baseUrl }}</span
				>
				<span
					v-else
					class="text-dimmed"
					>-</span
				>
			</template>
			<template #status-cell="{ row }">
				<UBadge
					:color="statusColor(row.original)"
					variant="subtle"
					size="sm"
				>
					{{ statusLabel(row.original) }}
				</UBadge>
			</template>
			<template #keyLast4-cell="{ row }">
				<span
					v-if="row.original.keyLast4"
					class="font-mono text-muted"
					>...{{ row.original.keyLast4 }}</span
				>
				<span
					v-else
					class="text-dimmed"
					>none</span
				>
			</template>
			<template #actions-cell="{ row }">
				<div class="flex flex-wrap items-center gap-1">
					<UButton
						v-if="row.original.baseUrl"
						icon="mdi:lan-connect"
						size="xs"
						variant="ghost"
						color="primary"
						title="Test Endpoint"
						aria-label="Test Endpoint"
						:loading="testingId === row.original.id"
						@click="onTest(row.original)"
					/>
					<UButton
						v-if="row.original.source === 'vllm'"
						icon="mdi:text-box-outline"
						size="xs"
						variant="ghost"
						color="neutral"
						title="View Log"
						aria-label="View Log"
						@click="openLog(row.original)"
					/>
					<UButton
						v-if="row.original.source === 'external'"
						icon="mdi:pencil"
						size="xs"
						variant="ghost"
						color="neutral"
						title="Edit"
						aria-label="Edit"
						@click="openEdit(row.original)"
					/>
					<UButton
						v-if="isRunning(row.original)"
						icon="mdi:stop-circle-outline"
						size="xs"
						variant="ghost"
						color="warning"
						title="Stop Server"
						aria-label="Stop Server"
						:loading="stoppingId === row.original.id"
						@click="onStop(row.original)"
					/>
					<UButton
						icon="mdi:delete"
						size="xs"
						variant="ghost"
						color="error"
						title="Delete"
						aria-label="Delete"
						@click="confirmRemove(row.original)"
					/>
				</div>
			</template>
		</UTable>

		<UModal
			v-model:open="formOpen"
			:title="editing ? 'Edit Endpoint' : 'Add Endpoint'"
			:dismissible="false"
			:close="false"
		>
			<template #body>
				<EndpointForm
					:key="editing?.id ?? 'new'"
					:endpoint="editing ?? undefined"
					@submit="formOpen = false"
					@cancel="formOpen = false"
				/>
			</template>
		</UModal>

		<UModal
			v-model:open="serveOpen"
			title="Serve With vLLM"
			:dismissible="false"
			:close="false"
			:ui="{ content: 'sm:max-w-2xl' }"
		>
			<template #body>
				<EndpointServeForm
					@started="serveOpen = false"
					@cancel="serveOpen = false"
				/>
			</template>
		</UModal>

		<UModal
			v-model:open="logOpen"
			:title="`Log: ${logTarget?.label ?? ''}`"
			:ui="{ content: 'sm:max-w-3xl' }"
		>
			<template #body>
				<pre
					class="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-elevated/50 p-3 font-mono text-xs"
					>{{ logTarget?.logTail || 'No output yet.' }}</pre>
			</template>
		</UModal>

		<UModal
			v-model:open="confirmOpen"
			title="Delete Endpoint"
		>
			<template #body>
				<div class="space-y-4">
					<p class="text-sm">
						Delete <strong>{{ pendingDelete?.label }}</strong
						>?
						<template v-if="pendingDelete?.source === 'vllm'"
							>A running server is stopped first.
						</template>
						<template v-if="pendingDelete?.adapterCount"
							>{{ pendingDelete.adapterCount }} adapter(s) fall back to Cloudflare Workers AI.
						</template>
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
const store = useEndpointsStore();
const toast = useToast();

onMounted(() => store.fetch().catch(() => {}));

const columns = [
	{ accessorKey: 'label', header: 'Label' },
	{ accessorKey: 'baseUrl', header: 'URL' },
	{ accessorKey: 'status', header: 'Status' },
	{ accessorKey: 'keyLast4', header: 'Key' },
	{ accessorKey: 'adapterCount', header: 'Adapters' },
	{ accessorKey: 'actions', header: '' }
];

const formOpen = ref(false);
const editing = ref<PublicEndpoint | null>(null);
const serveOpen = ref(false);
const logOpen = ref(false);
const logTarget = ref<PublicEndpoint | null>(null);
const confirmOpen = ref(false);
const pendingDelete = ref<PublicEndpoint | null>(null);
const testingId = ref<string | null>(null);
const stoppingId = ref<string | null>(null);
const deletingId = ref<string | null>(null);

function openCreate() {
	editing.value = null;
	formOpen.value = true;
}
function openEdit(endpoint: PublicEndpoint) {
	editing.value = endpoint;
	formOpen.value = true;
}
function openLog(endpoint: PublicEndpoint) {
	logTarget.value = endpoint;
	logOpen.value = true;
}
function confirmRemove(endpoint: PublicEndpoint) {
	pendingDelete.value = endpoint;
	confirmOpen.value = true;
}

const SERVE_LABELS: Record<string, string> = {
	queued: 'Queued',
	provisioning: 'Copying Files',
	starting: 'Starting',
	ready: 'Serving',
	stopping: 'Stopping',
	stopped: 'Stopped',
	failed: 'Failed'
};
const HEALTH_LABELS: Record<string, string> = {
	unchecked: 'Unchecked',
	ok: 'OK',
	unreachable: 'Unreachable',
	auth_failed: 'Key Rejected'
};

function statusLabel(endpoint: PublicEndpoint) {
	if (endpoint.source === 'vllm' && endpoint.serveStatus) {
		return SERVE_LABELS[endpoint.serveStatus] ?? endpoint.serveStatus;
	}
	return HEALTH_LABELS[endpoint.health] ?? 'Unchecked';
}
// param is `endpoint`, not a single letter: a name that matches a vue auto-import hides the import
function statusColor(endpoint: PublicEndpoint) {
	const key = endpoint.source === 'vllm' ? endpoint.serveStatus : endpoint.health;
	if (key === 'ready' || key === 'ok') return 'success';
	if (key === 'failed' || key === 'unreachable' || key === 'auth_failed') return 'error';
	if (key === 'stopped' || key === 'unchecked') return 'neutral';
	return 'info';
}
function isRunning(endpoint: PublicEndpoint) {
	return (
		endpoint.source === 'vllm' &&
		['queued', 'provisioning', 'starting', 'ready'].includes(endpoint.serveStatus ?? '')
	);
}

// a starting server is advanced from here too, so the page does not wait for the cron tick
const starting = computed(() =>
	store.endpoints.filter(
		(e) =>
			e.source === 'vllm' && ['queued', 'provisioning', 'starting'].includes(e.serveStatus ?? '')
	)
);
useIntervalFn(() => {
	for (const e of starting.value) store.poll(e.id).catch(() => {});
}, 6000);

async function onTest(endpoint: PublicEndpoint) {
	testingId.value = endpoint.id;
	try {
		const res = await store.test(endpoint.id);
		toast.add({
			title: res.endpoint.health === 'ok' ? 'Endpoint Reachable' : 'Endpoint Problem',
			description:
				res.endpoint.health === 'ok'
					? `${res.models.length} model(s) listed`
					: (res.endpoint.lastDiagnosis ?? undefined),
			color: res.endpoint.health === 'ok' ? 'success' : 'error',
			icon: res.endpoint.health === 'ok' ? 'mdi:check' : 'mdi:alert-circle'
		});
	} catch (e: any) {
		toast.add({
			title: 'Test Failed',
			description: e?.data?.statusMessage || 'Could not test the endpoint',
			color: 'error',
			icon: 'mdi:alert-circle'
		});
	} finally {
		testingId.value = null;
	}
}

async function onStop(endpoint: PublicEndpoint) {
	stoppingId.value = endpoint.id;
	try {
		await store.stop(endpoint.id);
		toast.add({ title: 'Server Stopped', color: 'success', icon: 'mdi:check' });
	} catch (e: any) {
		toast.add({
			title: 'Stop Failed',
			description: e?.data?.statusMessage || 'Could not stop the server',
			color: 'error',
			icon: 'mdi:alert-circle'
		});
	} finally {
		stoppingId.value = null;
	}
}

async function doRemove() {
	if (!pendingDelete.value) return;
	deletingId.value = pendingDelete.value.id;
	try {
		await store.remove(pendingDelete.value.id);
		confirmOpen.value = false;
	} catch (e: any) {
		toast.add({
			title: 'Delete Failed',
			description: e?.data?.statusMessage || 'Could not delete the endpoint',
			color: 'error',
			icon: 'mdi:alert-circle'
		});
	} finally {
		deletingId.value = null;
	}
}
</script>
