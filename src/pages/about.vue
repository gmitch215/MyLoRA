<template>
	<div class="w-full max-w-3xl mx-auto px-4 sm:px-8 py-12">
		<div class="flex flex-col items-center text-center mb-10">
			<UIcon
				name="mdi:cube-scan"
				class="size-12 text-primary mb-3"
			/>
			<h1 class="text-3xl md:text-4xl font-bold">About {{ siteName }}</h1>
			<p class="text-muted mt-2 max-w-xl">{{ tagline }}</p>
		</div>

		<div class="prose dark:prose-invert max-w-none">
			<p
				v-if="bio"
				class="whitespace-pre-line"
			>
				{{ bio }}
			</p>

			<h2>What is {{ siteName }}?</h2>
			<p>
				{{ siteName }} is a self-hostable registry for LoRA fine-tune adapters. Developers upload an
				adapter's config, weights, and screenshots so others can browse, download, and - once an
				adapter is explicitly published - test it directly against rate-limited Cloudflare Workers
				AI inference.
			</p>
			<p>
				Every adapter lists its base model, model type, rank, and size up front, so you can find
				something that fits your stack and try it in seconds.
			</p>
		</div>

		<div
			v-if="links.length"
			class="mt-10 flex flex-wrap gap-3 justify-center"
		>
			<UButton
				v-for="link in links"
				:key="link.label"
				:icon="link.icon"
				:to="link.to"
				target="_blank"
				color="neutral"
				variant="outline"
			>
				{{ link.label }}
			</UButton>
		</div>

		<p class="text-center text-muted text-sm mt-12">Powered by MyLoRA</p>
	</div>
</template>

<script setup lang="ts">
const settingsStore = useSettingsStore();
const config = useRuntimeConfig();

await useAsyncData('settings:about', () => settingsStore.fetch());

const siteName = computed(() => settingsStore.name || config.public.name);
const author = computed(() => settingsStore.author || config.public.author);
const tagline = computed(() => settingsStore.description || config.public.description);
const bio = computed(() => settingsStore.bio);

// social/links built from settings with runtimeConfig fallbacks
const links = computed(() => {
	const s = settingsStore.settings;
	const out: { label: string; icon: string; to: string }[] = [];
	const website = s.website || config.public.website;
	const github = s.github || config.public.github;
	const twitter = s.twitter || config.public.twitter;
	const linkedin = s.linkedin || config.public.linkedin;
	const discord = s.discord || config.public.discord;
	if (website) out.push({ label: 'Website', icon: 'mdi:web', to: website });
	if (github) out.push({ label: 'GitHub', icon: 'mdi:github', to: github });
	if (twitter) out.push({ label: 'Twitter', icon: 'mdi:twitter', to: twitter });
	if (linkedin) out.push({ label: 'LinkedIn', icon: 'mdi:linkedin', to: linkedin });
	if (discord) out.push({ label: 'Discord', icon: 'mdi:discord', to: discord });
	return out;
});

useSeoMeta({
	title: () => `About - ${siteName.value}`,
	description: () => `Learn more about ${author.value} and the ${siteName.value} registry.`,
	ogTitle: () => `About - ${siteName.value}`,
	ogDescription: () => `Learn more about ${author.value} and the ${siteName.value} registry.`
});
</script>
