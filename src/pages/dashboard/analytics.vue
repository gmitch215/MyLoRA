<template>
	<UDashboardPanel id="analytics">
		<template #header>
			<UDashboardNavbar
				title="Analytics"
				icon="mdi:chart-line"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<AnalyticsDashboard />
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'admin' });
useSeoMeta({ title: 'Analytics' });
</script>
