<template>
	<UApp :toaster="{ expand: false }">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
		<ClientOnly>
			<AppCommandPalette />
		</ClientOnly>
	</UApp>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const { settings, fetchSettings } = useSettings();

// fetch settings during ssr to prevent a flash of default config values
await fetchSettings();

const name = computed(() => settings.value.name || config.public.name);
const description = computed(() => settings.value.description || config.public.description);

useSeoMeta({
	charset: 'utf-8',
	viewport: {
		width: 'device-width',
		initialScale: 1
	},
	applicationName: name,
	title: name,
	description: description,
	ogTitle: name,
	author: () => settings.value.author || config.public.author,
	ogDescription: description,
	ogLocale: 'en_US',
	ogType: 'website',
	// the browser tint meta needs a real color; preset tokens fall back to the default hex
	themeColor: () =>
		isCustomColor(settings.value.themeColor)
			? settings.value.themeColor!
			: config.public.themeColor || '#6d28d9',
	ogSiteName: name,
	twitterTitle: name,
	twitterDescription: description,
	twitterCard: 'summary_large_image',
	mobileWebAppCapable: 'yes',
	appleMobileWebAppCapable: 'yes'
});

useHead({
	link: [
		// svg (iconify) is preferred when present; ico/png cover uploads + older browsers
		{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
		{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
		{ rel: 'icon', type: 'image/png', href: '/favicon.png' },
		{ rel: 'apple-touch-icon', href: '/favicon.png' }
	]
});

useSchemaOrg([
	defineWebSite({
		name: name.value,
		url: config.public.site_url,
		image: {
			'@type': 'ImageObject',
			url: (config.public.site_url || '') + '/favicon.png'
		},
		publisher: {
			'@type': 'Organization',
			name: name.value,
			logo: {
				'@type': 'ImageObject',
				url: (config.public.site_url || '') + '/favicon.png'
			}
		}
	})
]);
</script>
