<template>
	<UDashboardPanel id="machines">
		<template #header>
			<UDashboardNavbar
				title="Training Machines"
				icon="i-lucide-server"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<TrainingNotifications />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UAlert
				icon="mdi:information-outline"
				color="info"
				variant="subtle"
				title="Remote Training Machines"
				class="mb-4"
			>
				<template #description>
					<p>
						Register a GPU VPS or an ngrok-tunneled home box to run LoRA training jobs. Private keys
						and passwords are <strong>envelope-encrypted</strong> at rest and never returned.
						Managers register <strong>shared</strong> machines for everyone; trainers can register
						their own <strong>personal</strong> machines.
					</p>
				</template>
			</UAlert>

			<div class="scrollbar-hide overflow-x-auto">
				<TrainingMachineTable :auto-testing-ids="autoTestingIds" />
			</div>
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
const machines = useMachinesStore();
const route = useRoute();

definePageMeta({ layout: 'dashboard', middleware: 'training' });
useSeoMeta({ title: 'Training Machines' });

await useAsyncData('machines', async () => {
	await machines.fetch();
	return machines.machines.length;
});

// re-test any machine unchecked or last checked > 2 min ago
const STALE_MS = 2 * 60_000;
const AUTO_TEST_CONCURRENCY = 3;

// in-flight auto-test ids; reactive so the table spinner tracks it
const autoTestingIds = reactive(new Set<string>());
const autoRefreshing = ref(false);

function isStale(m: PublicMachine) {
	if (!m.lastCheckedAt) return true;
	return Date.now() - new Date(m.lastCheckedAt).getTime() > STALE_MS;
}

async function autoRefreshHealth() {
	// guard against overlapping runs on rapid re-navigation
	if (autoRefreshing.value) return;
	autoRefreshing.value = true;
	try {
		await machines.fetch();
		const stale = machines.machines.filter((m) => m.isActive && isStale(m)).map((m) => m.id);
		if (!stale.length) return;
		// bounded-concurrency worker pool; failures stay silent (row shows resulting health)
		let cursor = 0;
		const worker = async () => {
			while (cursor < stale.length) {
				const id = stale[cursor++]!;
				autoTestingIds.add(id);
				try {
					await machines.test(id);
				} catch {
					// silent on navigation; the row reflects its updated health
				} finally {
					autoTestingIds.delete(id);
				}
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(AUTO_TEST_CONCURRENCY, stale.length) }, worker)
		);
	} finally {
		autoRefreshing.value = false;
	}
}

// fire on mount, on kept-alive re-entry, and when the route becomes this page
onMounted(autoRefreshHealth);
onActivated(autoRefreshHealth);
watch(
	() => route.path,
	(path) => {
		if (path === '/dashboard/machines') autoRefreshHealth();
	}
);
</script>
