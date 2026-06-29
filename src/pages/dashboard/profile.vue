<template>
	<UDashboardPanel id="profile">
		<template #header>
			<UDashboardNavbar
				title="Profile"
				icon="mdi:account-circle"
			>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="max-w-2xl">
				<ProfileForm />
			</div>
		</template>
	</UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' });
useSeoMeta({ title: 'Profile' });
</script>
