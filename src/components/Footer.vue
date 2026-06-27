<template>
	<footer
		class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full mt-8 min-h-32 bg-elevated/40 border-t border-default text-muted text-left px-4 sm:px-8 md:px-12 py-6 text-xs sm:text-sm"
	>
		<div class="flex flex-col items-start gap-2">
			<span class="text-[10px] sm:text-xs">
				Copyright (c) {{ year }} {{ siteName }}. All Rights Reserved.
			</span>
			<div class="flex space-x-3 *:hover:opacity-70 *:transition-opacity *:duration-200">
				<NuxtLink
					v-if="github"
					:to="`https://github.com/${github}`"
					target="_blank"
					aria-label="GitHub"
				>
					<UIcon
						name="cib:github"
						size="1.5rem"
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
						size="1.5rem"
					/>
				</NuxtLink>
				<NuxtLink
					v-if="settings.patreon"
					:to="`https://patreon.com/${settings.patreon}`"
					target="_blank"
					aria-label="Patreon"
				>
					<UIcon
						name="cib:patreon"
						size="1.5rem"
					/>
				</NuxtLink>
				<NuxtLink
					v-if="settings.supportEmail"
					:to="`mailto:${settings.supportEmail}`"
					aria-label="Support email"
				>
					<UIcon
						name="mdi:email-outline"
						size="1.5rem"
					/>
				</NuxtLink>
			</div>
		</div>

		<div class="flex flex-col items-start sm:items-end gap-1 text-[10px] sm:text-xs">
			<span
				v-if="settings.supportEmail"
				class="text-muted"
			>
				Support:
				<NuxtLink
					:to="`mailto:${settings.supportEmail}`"
					class="hover:underline"
				>
					{{ settings.supportEmail }}
				</NuxtLink>
			</span>
			<span class="text-dimmed">
				powered by
				<NuxtLink
					to="https://github.com/gmitch215/MyLoRA"
					target="_blank"
					class="hover:underline"
				>
					MyLoRA
				</NuxtLink>
			</span>
		</div>
	</footer>
</template>

<script setup lang="ts">
const { settings } = useSettings();
const config = useRuntimeConfig();

const year = new Date().getFullYear();
const siteName = computed(() => settings.value.name || config.public.name || 'MyLoRA');
const github = computed(() => settings.value.github || config.public.github);
</script>
