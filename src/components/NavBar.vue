<template>
	<div
		id="navbar"
		class="border-b border-default py-3 px-3 sm:px-4 flex items-center bg-elevated/40"
	>
		<div class="flex min-w-0 items-center justify-center w-full sm:px-2">
			<div
				class="flex min-w-0 items-center justify-center sm:mr-8 space-x-2 md:space-x-4 lg:space-x-6"
			>
				<div
					class="flex min-w-0 flex-col text-center sm:text-left sm:flex-row justify-center items-center"
				>
					<NuxtLink
						to="/"
						:aria-label="siteName"
					>
						<!-- plain img: /favicon.png is a 302 to the configured icon, which _ipx cannot follow -->
						<img
							:src="FAVICON"
							alt=""
							width="40"
							height="40"
							class="min-w-4 w-8 h-auto lg:w-10 inline-block mr-2 hover:scale-105 transition-transform duration-300"
						/>
					</NuxtLink>
					<NuxtLink
						to="/"
						class="ml-2 mr-2 sm:mr-4 lg:mr-6 hidden max-w-full truncate text-xs sm:inline md:text-md lg:text-lg font-semibold text-highlighted"
					>
						{{ siteName }}
					</NuxtLink>
					<span
						class="hidden md:inline text-xs lg:text-sm whitespace-nowrap mr-2 sm:mr-4 text-muted"
					>
						{{ settings.description || config.public.description }}
					</span>
				</div>

				<div class="flex shrink-0 flex-wrap items-center gap-1 sm:gap-2 mr-2">
					<UButton
						icon="mdi:home"
						to="/"
						title="Home"
						aria-label="Home"
						variant="subtle"
						color="neutral"
					/>
					<UButton
						icon="mdi:tag-multiple"
						to="/tags"
						title="Tags"
						aria-label="Tags"
						variant="subtle"
						color="primary"
					/>
					<SearchButton />
					<UButton
						v-if="loggedIn"
						icon="mdi:flask"
						to="/playground"
						title="Playground"
						aria-label="Playground"
						variant="subtle"
						color="warning"
					/>
					<UButton
						icon="mdi:account-badge"
						to="/about"
						title="About"
						aria-label="About"
						variant="subtle"
						color="secondary"
					/>
				</div>
			</div>

			<div class="ml-auto shrink-0">
				<div class="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
					<!-- social icons -->
					<div
						class="hidden sm:flex items-center gap-2 lg:gap-3 light:opacity-70"
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
							aria-label="Dashboard"
							variant="subtle"
							color="neutral"
						/>
						<UButton
							icon="mdi:account-circle"
							to="/profile"
							title="Profile"
							aria-label="Profile"
							variant="subtle"
							color="info"
						/>
						<UButton
							icon="mdi:logout"
							title="Log Out"
							aria-label="Log Out"
							variant="ghost"
							color="error"
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
const router = useRouter();

const FAVICON = '/favicon.png';
const siteName = computed(() => settings.value.name || config.public.name || 'MyLoRA');

const loginOpen = ref(false);

// open the login modal from a ?login=1 query (matches the nuxtpress deep-link pattern)
watch(
	() => route.query.login,
	(v) => {
		if (v && !loggedIn.value) loginOpen.value = true;
	},
	{ immediate: true }
);

// clear the ?login marker once the modal closes,
watch(loginOpen, (open) => {
	if (!open && route.query.login != null) {
		const query = { ...route.query };
		delete query.login;
		router.replace({ query });
	}
});

const themeColorStyle = computed(() => {
	const color = settings.value.themeColor || config.public.themeColor;
	return color ? `color: ${resolveColorVar(color)}` : '';
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
