<template>
	<UTooltip :text="absolute">
		<span :class="muted ? 'text-muted' : ''">{{ relative }}</span>
	</UTooltip>
</template>

<script setup lang="ts">
import { DateTime } from 'luxon';

const props = withDefaults(
	defineProps<{ date: Date | string | number | null | undefined; muted?: boolean }>(),
	{ muted: true }
);

// normalize any incoming date shape into a luxon DateTime
const dt = computed<DateTime | null>(() => {
	const v = props.date;
	if (v == null || v === '') return null;
	if (v instanceof Date) return DateTime.fromJSDate(v);
	if (typeof v === 'number') return DateTime.fromMillis(v);
	const iso = DateTime.fromISO(String(v));
	if (iso.isValid) return iso;
	const n = Number(v);
	return Number.isFinite(n) ? DateTime.fromMillis(n) : null;
});

const relative = computed(() => (dt.value?.isValid ? (dt.value.toRelative() ?? '') : ''));
const absolute = computed(() =>
	dt.value?.isValid ? dt.value.toLocaleString(DateTime.DATETIME_FULL) : ''
);
</script>
