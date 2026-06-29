<template>
	<UDashboardPanel id="playground">
		<template #header>
			<UDashboardNavbar
				title="Playground"
				icon="mdi:flask"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<UAlert
				icon="mdi:rocket-launch"
				color="primary"
				variant="subtle"
				title="Unlimited Access for Developers"
				description="Test any published adapter against any registered Cloudflare account. Developer accounts have no rate limit on the playground by default."
				class="mb-4 shrink-0"
			/>
			<AiPlaygroundChat />
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' });
useSeoMeta({ title: 'Playground' });
</script>
