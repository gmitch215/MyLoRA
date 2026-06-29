<template>
	<UModal
		v-model:open="open"
		:ui="{ content: 'sm:max-w-2xl' }"
	>
		<template #content>
			<UCommandPalette
				v-model:search-term="search"
				:groups="groups"
				:loading="status === 'pending'"
				placeholder="Search adapters, run a command, or jump anywhere..."
				close
				@update:model-value="hide"
				@update:open="open = $event"
			>
				<template #empty>
					<div class="p-4 text-center text-sm text-muted">
						<template v-if="search">
							No matches for "{{ search }}".
							<UButton
								variant="link"
								size="xs"
								@click="goSearch"
							>
								Search the Full Catalog
							</UButton>
						</template>
						<template v-else>Type to search, or pick a command.</template>
					</div>
				</template>
			</UCommandPalette>
		</template>
	</UModal>
</template>

<script setup lang="ts">
const { open, toggle, show, hide } = useCommandPalette();
const search = ref('');
const auth = useAuthStore();
const colorMode = useColorMode();
const adaptersStore = useAdaptersStore();
const route = useRoute();
const router = useRouter();

watch(
	() => route.fullPath,
	() => {
		if (open.value) open.value = false;
	}
);

// clear the search box each time the palette closes so it reopens fresh
watch(open, (isOpen) => {
	if (!isOpen) search.value = '';
});

// lightweight client-side index of the public adapter feed (shared cache with the grid)
const { data, status } = await useFetch<{ items: Adapter[] }>('/api/adapters/list', {
	key: 'cmdk-adapters',
	query: { pageSize: 100, sort: 'newest' },
	lazy: true
});

function toggleTheme() {
	colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark';
}

// nav commands are gate-filtered so disallowed destinations never show; kbds render as hints
const navItems = computed(() => {
	const items: any[] = [
		{ id: 'home', label: 'Home', icon: 'mdi:home', to: '/', kbds: ['g', 'h'] },
		{ id: 'tags', label: 'Tags', icon: 'mdi:tag-multiple', to: '/tags', kbds: ['g', 't'] },
		{ id: 'about', label: 'About', icon: 'mdi:information', to: '/about' }
	];
	if (auth.loggedIn) {
		items.push({
			id: 'playground',
			label: 'Playground',
			icon: 'mdi:flask',
			to: '/playground',
			kbds: ['g', 'p']
		});
		items.push({
			id: 'dashboard',
			label: 'Dashboard',
			icon: 'mdi:view-dashboard',
			to: '/dashboard',
			kbds: ['g', 'd']
		});
		items.push({
			id: 'profile',
			label: 'Profile',
			icon: 'mdi:account-circle',
			to: '/dashboard/profile'
		});
	}
	if (auth.can('canManageAccounts'))
		items.push({
			id: 'cf',
			label: 'Cloudflare Accounts',
			icon: 'mdi:cloud',
			to: '/dashboard/cloudflare'
		});
	if (auth.isManager)
		items.push({
			id: 'settings',
			label: 'Settings',
			icon: 'mdi:cog',
			to: '/dashboard/settings',
			kbds: ['g', 's']
		});
	if (auth.isAdmin) {
		items.push({
			id: 'users',
			label: 'Users',
			icon: 'mdi:account-multiple',
			to: '/admin/users',
			kbds: ['g', 'u']
		});
		items.push({
			id: 'analytics',
			label: 'Analytics',
			icon: 'mdi:chart-line',
			to: '/dashboard/analytics',
			kbds: ['g', 'a']
		});
	}
	return items;
});

const actionItems = computed(() => {
	const items: any[] = [];
	if (auth.can('canCreate'))
		items.push({
			id: 'new',
			label: 'New Adapter',
			icon: 'mdi:plus',
			kbds: ['n'],
			onSelect: () => router.push('/dashboard?new=1')
		});
	items.push({
		id: 'theme',
		label: colorMode.value === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
		icon: colorMode.value === 'dark' ? 'mdi:weather-sunny' : 'mdi:weather-night',
		onSelect: toggleTheme
	});
	items.push({
		id: 'refresh',
		label: 'Refresh Adapters',
		icon: 'mdi:refresh',
		onSelect: () => adaptersStore.fetchList()
	});
	if (auth.loggedIn)
		items.push({
			id: 'logout',
			label: 'Log Out',
			icon: 'mdi:logout',
			onSelect: () => auth.logout()
		});
	else
		items.push({
			id: 'login',
			label: 'Log In',
			icon: 'mdi:login',
			onSelect: () => router.push('/?login=1')
		});
	return items;
});

const adapterItems = computed(() => {
	const q = search.value.toLowerCase();
	return (data.value?.items ?? [])
		.filter((a) => {
			if (!q) return true;
			return (
				a.name.toLowerCase().includes(q) ||
				a.slug.toLowerCase().includes(q) ||
				(a.description ?? '').toLowerCase().includes(q) ||
				a.tags.some((t) => t.toLowerCase().includes(q))
			);
		})
		.slice(0, 8)
		.map((a) => ({
			id: a.id,
			label: a.name,
			suffix: a.baseModel.split('/').pop(),
			icon: a.iconName || 'mdi:cube-outline',
			to: `/adapters/${a.slug}`
		}));
});

const groups = computed(() => {
	const g: any[] = [
		{ id: 'navigate', label: 'Navigate', items: navItems.value },
		{ id: 'actions', label: 'Actions', items: actionItems.value }
	];
	if (adapterItems.value.length)
		g.push({ id: 'adapters', label: 'Adapters', items: adapterItems.value });
	return g;
});

function goSearch() {
	router.push({ path: '/', query: { q: search.value } });
	open.value = false;
}

defineShortcuts({
	meta_k: () => toggle(),
	ctrl_k: () => toggle(),
	'/': () => show(),
	n: () => {
		if (auth.can('canCreate')) router.push('/dashboard?new=1');
	},
	'g-h': () => router.push('/'),
	'g-t': () => router.push('/tags'),
	'g-p': () => router.push('/playground'),
	'g-d': () => router.push('/dashboard'),
	'g-s': () => router.push('/dashboard/settings'),
	'g-u': () => router.push('/admin/users'),
	'g-a': () => router.push('/dashboard/analytics')
});
</script>
