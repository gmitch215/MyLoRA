<template>
	<div
		:class="[
			'relative inline-flex items-center justify-center overflow-hidden rounded-full bg-elevated/60 ring-1 ring-default',
			sizeClass
		]"
		:title="title || displayName"
	>
		<img
			v-if="src"
			:src="src"
			:alt="displayName ? `${displayName} avatar` : 'avatar'"
			:class="['h-full w-full object-cover', { invisible: failed }]"
			loading="lazy"
			decoding="async"
			@error="onError"
		/>
		<span
			v-if="!src || failed"
			class="text-muted font-medium select-none"
			:class="initialClass"
			aria-hidden="true"
		>
			{{ initial }}
		</span>
	</div>
</template>

<script setup lang="ts">
import type { PublicUser } from '~/shared/types';

// accepts a user or a raw pathname; renders an image from /avatars/{pathname} or initials
const props = withDefaults(
	defineProps<{
		user?: PublicUser | null;
		pathname?: string | null;
		displayName?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
		title?: string;
	}>(),
	{ size: 'md' }
);

const failed = ref(false);

// resolve from explicit pathname or the user's avatarPathname
const resolvedPathname = computed(() => props.pathname ?? props.user?.avatarPathname ?? null);
const displayName = computed(() => props.displayName ?? props.user?.displayName ?? '');

watch(resolvedPathname, () => {
	failed.value = false;
});

const src = computed(() => {
	const p = resolvedPathname.value;
	if (!p) return null;
	if (/^(https?:)?\//.test(p)) return p;
	return `/avatars/${encodeURIComponent(p)}`;
});

const sizeClass = computed(
	() =>
		({
			xs: 'h-6 w-6 text-xs',
			sm: 'h-8 w-8 text-sm',
			md: 'h-10 w-10 text-base',
			lg: 'h-16 w-16 text-xl',
			xl: 'h-24 w-24 text-3xl'
		})[props.size]
);

const initialClass = computed(() =>
	props.size === 'xl' ? 'text-3xl' : props.size === 'lg' ? 'text-xl' : 'text-sm'
);

const initial = computed(() => (displayName.value?.[0] ?? '?').toUpperCase());

function onError() {
	failed.value = true;
}
</script>
