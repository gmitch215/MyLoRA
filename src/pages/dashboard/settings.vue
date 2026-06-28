<template>
	<UDashboardPanel id="settings">
		<template #header>
			<UDashboardNavbar
				title="Settings"
				icon="mdi:cog"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<SettingsForm />
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'manager' });
useSeoMeta({ title: 'Settings' });
</script>
