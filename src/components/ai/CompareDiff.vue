<template>
	<div class="flex flex-col gap-4">
		<!-- legend + raw toggle -->
		<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
			<div class="flex flex-wrap items-center gap-3">
				<span class="flex items-center gap-1.5">
					<span class="inline-block size-3 rounded-sm bg-error/30" />
					Only In {{ labelA }}
				</span>
				<span class="flex items-center gap-1.5">
					<span class="inline-block size-3 rounded-sm bg-success/30" />
					Only In {{ labelB }}
				</span>
			</div>
			<UButton
				:icon="raw ? 'mdi:format-list-text' : 'mdi:text-long'"
				size="xs"
				variant="ghost"
				color="neutral"
				:label="raw ? 'Show Diff' : 'Show Raw'"
				@click="raw = !raw"
			/>
		</div>

		<div
			v-if="!pairs.length"
			class="py-8 text-center text-sm text-muted"
		>
			Send a prompt to both targets first, then compare how their answers diverge.
		</div>

		<div
			v-for="(pair, i) in pairs"
			:key="i"
			class="flex flex-col gap-2 rounded-lg border border-default p-3"
		>
			<div class="flex items-center gap-2 text-xs font-semibold text-muted">
				<UIcon
					name="mdi:help-circle-outline"
					class="size-3.5"
				/>
				Turn {{ i + 1 }}
			</div>
			<p class="rounded-md bg-elevated/60 px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word">
				{{ pair.question }}
			</p>

			<!-- column headers -->
			<div class="grid grid-cols-2 gap-x-3 text-xs font-semibold text-muted">
				<span class="truncate">{{ labelA }}</span>
				<span class="truncate">{{ labelB }}</span>
			</div>

			<!-- raw mode: plain answers side by side -->
			<div
				v-if="raw"
				class="grid grid-cols-2 gap-x-3 gap-y-1"
			>
				<p
					class="rounded-md bg-default/60 px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word text-default"
				>
					{{ pair.a || '(no response)' }}
				</p>
				<p
					class="rounded-md bg-default/60 px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word text-default"
				>
					{{ pair.b || '(no response)' }}
				</p>
			</div>

			<!-- diff mode: shared lines collapse full-width, divergent lines align left/right -->
			<div
				v-else
				class="grid grid-cols-2 gap-x-3 gap-y-1"
			>
				<template
					v-for="(row, r) in rowsFor(pair)"
					:key="r"
				>
					<p
						v-if="row.type === 'eq'"
						class="col-span-2 rounded-md bg-default/40 px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word text-muted"
					>
						{{ row.left }}
					</p>
					<template v-else>
						<AiDiffCell
							:left="row.left"
							:right="row.right"
							side="left"
						/>
						<AiDiffCell
							:left="row.left"
							:right="row.right"
							side="right"
						/>
					</template>
				</template>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { diffRows } from '~/composables/useTextDiff';

const props = defineProps<{
	pairs: { question: string; a: string; b: string }[];
	labelA: string;
	labelB: string;
}>();

const raw = ref(false);

function rowsFor(pair: { a: string; b: string }) {
	return diffRows(pair.a, pair.b);
}
</script>
