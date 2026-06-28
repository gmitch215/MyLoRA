<template>
	<div
		class="rounded-md px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word"
		:class="cellClass"
	>
		<span
			v-if="text == null"
			class="text-muted/60 italic"
			>&mdash;</span
		>
		<template v-else>
			<span
				v-for="(op, i) in tokens"
				:key="i"
				:class="tokenClass(op.t)"
				>{{ op.v }}</span
			>
		</template>
	</div>
</template>

<script setup lang="ts">
import { diffWords } from '~/composables/useTextDiff';

// one side of a side-by-side change row; word-level highlights only the parts that differ from the
// other side, so a reworded sentence reads naturally instead of as interleaved noise
const props = defineProps<{ left: string | null; right: string | null; side: 'left' | 'right' }>();

const text = computed(() => (props.side === 'left' ? props.left : props.right));

const tokens = computed(() => {
	const ops = diffWords(props.left || '', props.right || '');
	// left shows common + removed; right shows common + inserted
	return props.side === 'left'
		? ops.filter((o) => o.t !== 'ins')
		: ops.filter((o) => o.t !== 'del');
});

const cellClass = computed(() => {
	if (text.value == null) return 'bg-default/40';
	return props.side === 'left' ? 'bg-error/10' : 'bg-success/10';
});

function tokenClass(t: 'eq' | 'del' | 'ins') {
	if (t === 'del') return 'rounded-sm bg-error/25 text-error';
	if (t === 'ins') return 'rounded-sm bg-success/25 text-success';
	return 'text-default';
}
</script>
