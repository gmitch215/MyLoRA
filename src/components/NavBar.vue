<template>
	<div
		id="navbar"
		class="border-b border-default py-3 sm:px-4 flex items-center bg-elevated/40"
	>
		<div class="flex items-center justify-center w-full sm:px-2">
			<div class="flex items-center justify-center sm:mr-8 space-x-2 md:space-x-4 lg:space-x-6">
				<div class="flex flex-col text-center sm:text-left sm:flex-row justify-center items-center">
					<NuxtLink to="/">
						<NuxtImg
							src="/favicon.png"
							alt="Logo"
							class="min-w-4 w-8 h-auto lg:w-10 inline-block mr-2 hover:scale-105 transition-transform duration-300"
						/>
					</NuxtLink>
					<NuxtLink
						to="/"
						class="ml-2 mr-2 sm:mr-4 lg:mr-6 text-xs md:text-md lg:text-lg font-semibold text-highlighted"
					>
						{{ settings.name || config.public.name || 'MyLoRA' }}
					</NuxtLink>
					<span
						class="hidden md:inline text-xs lg:text-sm whitespace-nowrap mr-2 sm:mr-4 text-muted"
					>
						{{ settings.description || config.public.description }}
					</span>
				</div>

				<div class="grid grid-cols-2 gap-1 sm:space-y-0 sm:flex sm:space-x-2 mr-2">
					<UButton
						icon="mdi:home"
						to="/"
						title="Home"
						variant="subtle"
						color="neutral"
					/>
					<UButton
						icon="mdi:tag-multiple"
						to="/tags"
						title="Tags"
						variant="subtle"
						color="neutral"
					/>
					<SearchButton />
					<UButton
						icon="mdi:flask"
						to="/playground"
						title="Playground"
						variant="subtle"
						color="neutral"
					/>
					<UButton
						icon="mdi:account-badge"
						to="/about"
						title="About"
						variant="subtle"
						color="neutral"
					/>
				</div>
			</div>

			<div class="ml-auto">
				<div class="flex items-center space-x-2 sm:space-x-3">
					<!-- social icons -->
					<div
						class="hidden md:flex items-center space-x-2 lg:space-x-3 light:opacity-70"
						:style="themeColorStyle"
					>
						<NuxtLink
							v-if="settings.website"
							:to="settings.website"
							target="_blank"
							aria-label="Website"
						>
							<UIcon
								name="mdi:web"
								class="size-5"
							/>
						</NuxtLink>
						<NuxtLink
							v-if="settings.github"
							:to="`https://github.com/${settings.github}`"
							target="_blank"
							aria-label="GitHub"
						>
							<UIcon
								name="cib:github"
								class="size-5"
							/>
						</NuxtLink>
						<NuxtLink
							v-if="settings.twitter"
							:to="`https://x.com/${settings.twitter}`"
							target="_blank"
							aria-label="Twitter"
						>
							<UIcon
								name="cib:twitter"
								class="size-5"
							/>
						</NuxtLink>
						<NuxtLink
							v-if="settings.discord"
							:to="settings.discord"
							target="_blank"
							aria-label="Discord"
						>
							<UIcon
								name="cib:discord"
								class="size-5"
							/>
						</NuxtLink>
					</div>

					<UColorModeButton />

					<template v-if="loggedIn">
						<UButton
							icon="mdi:view-dashboard"
							to="/dashboard"
							title="Dashboard"
							variant="subtle"
							color="neutral"
						/>
						<UButton
							icon="mdi:account-circle"
							to="/profile"
							title="Profile"
							variant="subtle"
							color="neutral"
						/>
						<UButton
							icon="mdi:logout"
							title="Log Out"
							variant="ghost"
							color="neutral"
							@click="onLogout"
						/>
					</template>
					<template v-else>
						<UButton
							icon="mdi:account-lock-open"
							variant="subtle"
							color="primary"
							@click="loginOpen = true"
						>
							<span class="hidden sm:inline">Log In</span>
						</UButton>
					</template>
				</div>
			</div>
		</div>

		<UModal
			v-model:open="loginOpen"
			title="Log In"
		>
			<template #body>
				<LoginForm @success="onLoginSuccess" />
			</template>
		</UModal>
	</div>
	<LazyUBanner
		v-if="message"
		id="message"
		:title="message.text"
		:icon="message.icon"
		:color="message.type"
		:to="message.link || undefined"
		close
		class="mb-4"
	/>
</template>

<script setup lang="ts">
const { settings } = useSettings();
const auth = useAuthStore();
const { loggedIn } = storeToRefs(auth);
const config = useRuntimeConfig();
const route = useRoute();

const loginOpen = ref(false);

// open the login modal from a ?login=1 query (matches the nuxtpress deep-link pattern)
watch(
	() => route.query.login,
	(v) => {
		if (v && !loggedIn.value) loginOpen.value = true;
	},
	{ immediate: true }
);

const themeColorStyle = computed(() => {
	const color = settings.value.themeColor || config.public.themeColor;
	return color ? `color: ${color}` : '';
});

// optional banner message persisted in settings
const message = computed<any>(() => (settings.value as any).message ?? null);

function onLoginSuccess() {
	loginOpen.value = false;
}

async function onLogout() {
	await auth.logout();
	if (route.path.startsWith('/dashboard') || route.path.startsWith('/admin')) {
		navigateTo('/');
	}
}
</script>
