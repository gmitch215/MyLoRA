<template>
	<div class="space-y-2">
		<div class="flex items-center gap-2">
			<span
				class="size-7 shrink-0 rounded-full border border-default"
				:style="{ backgroundColor: preview }"
			/>
			<span class="text-xs text-muted">
				{{ selectedLabel }}
			</span>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<button
				v-for="c in presets"
				:key="c"
				type="button"
				class="size-6 rounded-full ring-2 ring-offset-2 ring-offset-default transition hover:scale-110"
				:class="modelValue === c ? 'ring-inverted' : 'ring-transparent'"
				:style="{ backgroundColor: `var(--ui-color-${c}-500)` }"
				:title="c"
				@click="emit('update:modelValue', c)"
			/>

			<!-- custom color swatch wraps a native color input -->
			<label
				class="relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-default"
				:class="custom ? 'ring-inverted' : 'ring-transparent'"
				:style="custom ? { backgroundColor: modelValue || '#000000' } : {}"
				title="Custom color"
			>
				<UIcon
					v-if="!custom"
					name="mdi:eyedropper-variant"
					class="size-3.5 text-muted"
				/>
				<input
					type="color"
					class="absolute inset-0 cursor-pointer opacity-0"
					:value="customHex"
					@input="onPick"
				/>
			</label>

			<UButton
				v-if="clearable && modelValue"
				icon="mdi:close"
				size="xs"
				variant="ghost"
				color="neutral"
				title="Clear"
				@click="emit('update:modelValue', '')"
			/>
		</div>

		<div class="flex items-center gap-2">
			<UInput
				:model-value="custom ? (modelValue ?? '') : ''"
				placeholder="#3B82F6"
				size="sm"
				class="w-32 font-mono"
				@update:model-value="onHex"
			/>
			<span class="text-xs text-muted">preset or hex</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import { isCustomColor, isNuxtColor, NUXT_COLORS, resolveColorVar } from '~/shared/colors';

const props = withDefaults(
	defineProps<{ modelValue?: string | null; presets?: readonly string[]; clearable?: boolean }>(),
	{ presets: () => NUXT_COLORS, clearable: false }
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const custom = computed(() => isCustomColor(props.modelValue));
const customHex = computed(() => (custom.value ? (props.modelValue as string) : '#3b82f6'));

// resolved css color for the preview swatch, and a human label (token name, hex, or "none")
const preview = computed(() => resolveColorVar(props.modelValue, 'var(--ui-bg-elevated)'));
const selectedLabel = computed(() => {
	const v = props.modelValue;
	if (!v) return 'No Color Selected';
	if (isNuxtColor(v)) return v.charAt(0).toUpperCase() + v.slice(1);
	if (isCustomColor(v)) return v.toUpperCase();
	return 'No Color Selected';
});

function onPick(e: Event) {
	emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function onHex(v: string) {
	emit('update:modelValue', v.trim());
}
</script>
