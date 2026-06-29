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
		<UIcon
			v-else-if="icon"
			:name="icon"
			:class="iconClass"
			:style="{ color: resolveColorVar(iconColor, 'var(--ui-text-toned)') }"
			aria-hidden="true"
		/>
		<span
			v-else
			class="text-muted font-medium select-none"
			:class="initialClass"
			aria-hidden="true"
		>
			{{ initial }}
		</span>
	</div>
</template>

<script setup lang="ts">
// accepts a user or a raw pathname; renders an image, then an iconify icon, then initials
const props = withDefaults(
	defineProps<{
		user?: PublicUser | null;
		pathname?: string | null;
		displayName?: string;
		icon?: string | null;
		iconColor?: string | null;
		size?: '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';
		title?: string;
	}>(),
	{ size: 'md' }
);

const failed = ref(false);

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
			'2xs': 'h-5 w-5 text-[10px]',
			xs: 'h-6 w-6 text-xs',
			sm: 'h-8 w-8 text-sm',
			md: 'h-10 w-10 text-base',
			lg: 'h-16 w-16 text-xl',
			xl: 'h-24 w-24 text-3xl'
		})[props.size]
);

const iconClass = computed(
	() =>
		({
			'2xs': 'size-3',
			xs: 'size-4',
			sm: 'size-5',
			md: 'size-6',
			lg: 'size-9',
			xl: 'size-14'
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
