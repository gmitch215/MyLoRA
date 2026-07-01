<template>
	<div class="space-y-2">
		<p
			v-if="statusMessage"
			class="text-xs text-muted"
		>
			{{ statusMessage }}
		</p>
		<div
			class="scrollbar-hide max-h-72 overflow-auto rounded border border-default bg-default/60 p-3"
		>
			<pre
				v-if="cleaned"
				class="whitespace-pre-wrap wrap-break-word font-mono text-xs text-toned"
				>{{ cleaned }}</pre>
			<p
				v-else
				class="text-xs text-muted"
			>
				No log output yet.
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ logTail?: string | null; statusMessage?: string | null }>();
const cleaned = computed(() => collapseCarriageReturns(props.logTail));
</script>
