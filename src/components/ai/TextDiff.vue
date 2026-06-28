<template>
	<p class="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
		<span
			v-for="(op, i) in ops"
			:key="i"
			:class="cls(op.t)"
			>{{ op.v }}</span
		>
	</p>
</template>

<script setup lang="ts">
import { diffWords } from '~/composables/useTextDiff';

const props = defineProps<{ a: string; b: string }>();

const ops = computed(() => diffWords(props.a, props.b));

// removed (only in A) struck red, inserted (only in B) green, common neutral
function cls(t: 'eq' | 'del' | 'ins') {
	if (t === 'del') return 'bg-error/15 text-error line-through decoration-error/50';
	if (t === 'ins') return 'bg-success/15 text-success';
	return 'text-default';
}
</script>
