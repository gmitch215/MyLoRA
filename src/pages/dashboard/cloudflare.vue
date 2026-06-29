<template>
	<UDashboardPanel id="cloudflare">
		<template #header>
			<UDashboardNavbar
				title="Cloudflare Accounts"
				icon="mdi:cloud"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UAlert
				icon="mdi:information-outline"
				color="info"
				variant="subtle"
				title="Hybrid Cloudflare Accounts"
				class="mb-4"
			>
				<template #description>
					<p>
						Admins and managers register <strong>shared</strong> accounts that anyone can publish
						to; developers may bring their own <strong>personal</strong> account per adapter. Each
						account holds up to <strong>100 finetune adapters</strong> (Cloudflare's per-account
						cap). API tokens are <strong>envelope-encrypted</strong> at rest; only the last 4
						characters are ever shown.
					</p>
				</template>
			</UAlert>

			<div class="mb-6">
				<CloudflareSlotMeter
					:used="cf.totalSlotsUsed"
					:max="totalCapacity"
					label="Total Adapter Slots Used"
				/>
			</div>

			<div class="scrollbar-hide overflow-x-auto">
				<CloudflareAccountsTable />
			</div>
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
const cf = useCfAccountsStore();

// 100 slots per registered account is the cloudflare cap
const totalCapacity = computed(() => cf.accounts.length * 100);

definePageMeta({ layout: 'dashboard', middleware: 'accounts' });
useSeoMeta({ title: 'Cloudflare Accounts' });

await useAsyncData('cf-accounts', async () => {
	await cf.fetch();
	return cf.accounts.length;
});
</script>
