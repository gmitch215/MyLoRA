<template>
	<UDashboardGroup>
		<UDashboardSidebar
			id="dashboard-sidebar"
			collapsible
			:ui="{ footer: 'border-t border-default' }"
		>
			<template #header>
				<NuxtLink
					to="/"
					class="flex items-center gap-2 font-semibold"
				>
					<NuxtImg
						src="/favicon.png"
						alt="Logo"
						class="w-7 h-7"
					/>
					<span class="truncate">{{ settings.name || $config.public.name }}</span>
				</NuxtLink>
			</template>

			<SearchButton class="mb-2 w-full justify-start" />

			<UNavigationMenu
				orientation="vertical"
				:items="navItems"
			/>

			<template #footer>
				<UButton
					icon="mdi:arrow-left"
					to="/"
					color="neutral"
					variant="ghost"
					label="Back to Site"
					block
				/>
			</template>
		</UDashboardSidebar>

		<slot />
	</UDashboardGroup>
</template>

<script setup lang="ts">
const { settings } = useSettings();
const auth = useAuthStore();

// dashboard nav reflects the viewer's capabilities
const navItems = computed(() => {
	const items: any[] = [
		{ label: 'My Adapters', icon: 'mdi:view-grid', to: '/dashboard' },
		{ label: 'Playground', icon: 'mdi:flask', to: '/playground' },
		{ label: 'Profile', icon: 'mdi:account-circle', to: '/dashboard/profile' }
	];
	if (auth.can('canManageAccounts')) {
		items.push({ label: 'Cloudflare', icon: 'mdi:cloud', to: '/dashboard/cloudflare' });
	}
	// settings is manager+; analytics + users are admin-only
	if (auth.isManager) {
		items.push({ label: 'Settings', icon: 'mdi:cog', to: '/dashboard/settings' });
	}
	if (auth.isAdmin) {
		items.push({ label: 'Users', icon: 'mdi:account-multiple', to: '/admin/users' });
		items.push({ label: 'Analytics', icon: 'mdi:chart-line', to: '/dashboard/analytics' });
	}
	return items;
});
</script>
