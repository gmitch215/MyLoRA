<template>
	<div class="space-y-6">
		<section class="space-y-3">
			<h4 class="text-sm font-semibold text-highlighted">Public (anonymous)</h4>
			<div class="grid gap-3 sm:grid-cols-3">
				<UFormField
					label="Prompts / Hour"
					:help="`How many prompts to allow per hour (${ranges.promptsPerHour.min}-${ranges.promptsPerHour.max})`"
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
					:help="`How many output tokens to allow per hour (${ranges.outputTokensPerHour.min}-${ranges.outputTokensPerHour.max})`"
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
					help="What to prioritize when the public rate limit is exceeded"
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

		<section class="space-y-3">
			<h4 class="text-sm font-semibold text-highlighted">Developer / Playground</h4>
			<div class="grid gap-3 sm:grid-cols-3">
				<UFormField
					label="Prompts / Hour"
					help="0 = unlimited"
				>
					<UInput
						:model-value="model.developer.promptsPerHour"
						type="number"
						:min="0"
						class="w-full"
						color="error"
						highlight
						@update:model-value="setDeveloper('promptsPerHour', $event)"
					/>
				</UFormField>
				<UFormField
					label="Output Tokens / Hour"
					help="0 = unlimited"
				>
					<UInput
						:model-value="model.developer.outputTokensPerHour"
						type="number"
						:min="0"
						class="w-full"
						color="error"
						highlight
						@update:model-value="setDeveloper('outputTokensPerHour', $event)"
					/>
				</UFormField>
				<UFormField label="Precedence">
					<USelect
						:model-value="model.developer.precedence"
						:items="precedenceItems"
						value-key="value"
						class="w-full"
						color="error"
						highlight
						@update:model-value="setPrecedence('developer', $event)"
					/>
				</UFormField>
			</div>
		</section>
	</div>
</template>

<script setup lang="ts">
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
