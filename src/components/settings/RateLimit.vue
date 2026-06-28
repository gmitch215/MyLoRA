<template>
	<div class="space-y-6">
		<!-- public/anonymous tier; clamped to PUBLIC_LIMIT_RANGES -->
		<section class="space-y-3">
			<h4 class="text-sm font-semibold text-highlighted">Public (anonymous)</h4>
			<div class="grid gap-3 sm:grid-cols-3">
				<UFormField
					label="Prompts / hour"
					:help="`${ranges.promptsPerHour.min}-${ranges.promptsPerHour.max}`"
				>
					<UInput
						:model-value="model.public.promptsPerHour"
						type="number"
						:min="ranges.promptsPerHour.min"
						:max="ranges.promptsPerHour.max"
						class="w-full"
						@update:model-value="setPublic('promptsPerHour', $event)"
					/>
				</UFormField>
				<UFormField
					label="Output Tokens / Hour"
					:help="`${ranges.outputTokensPerHour.min}-${ranges.outputTokensPerHour.max}`"
				>
					<UInput
						:model-value="model.public.outputTokensPerHour"
						type="number"
						:min="ranges.outputTokensPerHour.min"
						:max="ranges.outputTokensPerHour.max"
						class="w-full"
						@update:model-value="setPublic('outputTokensPerHour', $event)"
					/>
				</UFormField>
				<UFormField
					label="Precedence"
					help="Primary gate + surfaced reset"
				>
					<USelect
						:model-value="model.public.precedence"
						:items="precedenceItems"
						value-key="value"
						class="w-full"
						@update:model-value="setPrecedence('public', $event)"
					/>
				</UFormField>
			</div>
		</section>

		<!-- developer/playground tier; 0 = unlimited, no upper bound -->
		<section class="space-y-3">
			<h4 class="text-sm font-semibold text-highlighted">Developer / playground</h4>
			<p class="text-xs text-muted">0 = unlimited</p>
			<div class="grid gap-3 sm:grid-cols-3">
				<UFormField label="Prompts / hour">
					<UInput
						:model-value="model.developer.promptsPerHour"
						type="number"
						:min="0"
						class="w-full"
						@update:model-value="setDeveloper('promptsPerHour', $event)"
					/>
				</UFormField>
				<UFormField label="Output Tokens / Hour">
					<UInput
						:model-value="model.developer.outputTokensPerHour"
						type="number"
						:min="0"
						class="w-full"
						@update:model-value="setDeveloper('outputTokensPerHour', $event)"
					/>
				</UFormField>
				<UFormField label="Precedence">
					<USelect
						:model-value="model.developer.precedence"
						:items="precedenceItems"
						value-key="value"
						class="w-full"
						@update:model-value="setPrecedence('developer', $event)"
					/>
				</UFormField>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
import { PUBLIC_LIMIT_RANGES, clampPublicLimit } from '~/shared/defaults';
import type { RateLimits } from '~/shared/types';

const props = defineProps<{ modelValue: RateLimits }>();
const emit = defineEmits<{ 'update:modelValue': [value: RateLimits] }>();

const model = computed(() => props.modelValue);
const ranges = PUBLIC_LIMIT_RANGES;

const precedenceItems = [
	{ label: 'Prompts', value: 'prompts' },
	{ label: 'Tokens', value: 'tokens' }
];

function toNum(v: unknown): number {
	const n = typeof v === 'number' ? v : parseInt(String(v), 10);
	return Number.isFinite(n) ? n : 0;
}

// public values are clamped into the configured ranges
function setPublic(field: 'promptsPerHour' | 'outputTokensPerHour', v: unknown) {
	emit('update:modelValue', {
		...props.modelValue,
		public: { ...props.modelValue.public, [field]: clampPublicLimit(field, toNum(v)) }
	});
}

// developer values are never clamped
function setDeveloper(field: 'promptsPerHour' | 'outputTokensPerHour', v: unknown) {
	emit('update:modelValue', {
		...props.modelValue,
		developer: { ...props.modelValue.developer, [field]: Math.max(0, toNum(v)) }
	});
}

function setPrecedence(tier: 'public' | 'developer', v: unknown) {
	emit('update:modelValue', {
		...props.modelValue,
		[tier]: { ...props.modelValue[tier], precedence: v as 'prompts' | 'tokens' }
	});
}
</script>
