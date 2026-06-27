<template>
	<div class="space-y-6">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<UTabs
				v-model="range"
				:items="rangeOptions"
				size="sm"
				:content="false"
			/>
			<UButton
				icon="mdi:refresh"
				title="Refresh"
				aria-label="Refresh analytics"
				variant="ghost"
				size="sm"
				:loading="pending"
				@click="() => refresh()"
			/>
		</div>

		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<KpiCard
				label="Views"
				:value="data?.kpis.views.value ?? 0"
				:prev="data?.kpis.views.prev ?? 0"
				:loading="pending"
			/>
			<KpiCard
				label="Unique Visitors"
				:value="data?.kpis.unique.value ?? 0"
				:prev="data?.kpis.unique.prev ?? 0"
				:loading="pending"
			/>
			<KpiCard
				label="Avg Active Read"
				:value="data?.kpis.avgActiveMs.value ?? 0"
				:prev="data?.kpis.avgActiveMs.prev ?? 0"
				:loading="pending"
				format="duration"
			/>
			<KpiCard
				label="Completion"
				:value="data?.kpis.completionRate.value ?? 0"
				:prev="data?.kpis.completionRate.prev ?? 0"
				:loading="pending"
				format="percent"
			/>
		</div>

		<section class="rounded border border-default p-3">
			<h3 class="text-sm font-medium mb-2 text-highlighted">Views Over Time</h3>
			<div
				v-if="pending"
				class="h-40"
			>
				<USkeleton class="h-full w-full" />
			</div>
			<div
				v-else-if="!data || data.perDay.length === 0"
				class="text-muted text-center py-8 text-sm"
			>
				No data for this range.
			</div>
			<LazyAnalyticsViewsChart
				v-else
				:per-day="data.perDay"
				:height="180"
			/>
		</section>

		<section class="rounded border border-default p-3">
			<h3 class="text-sm font-medium mb-2 text-highlighted">Top Adapters</h3>
			<div
				v-if="pending"
				class="h-32"
			>
				<USkeleton class="h-full w-full" />
			</div>
			<div
				v-else-if="!data || data.topAdapters.length === 0"
				class="text-muted text-center py-6 text-sm"
			>
				No adapters tracked yet.
			</div>
			<div
				v-else
				class="overflow-x-auto"
			>
				<table class="min-w-full text-sm">
					<thead class="text-left text-muted">
						<tr>
							<th class="p-2">Adapter</th>
							<th class="p-2">Views</th>
							<th class="p-2">Unique</th>
							<th class="p-2">Avg read</th>
							<th class="p-2">Completion</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in data.topAdapters"
							:key="row.slug"
							class="border-t border-default"
						>
							<td class="p-2 max-w-xs truncate">
								<NuxtLink
									:to="`/adapters/${row.slug}`"
									class="hover:underline"
								>
									{{ row.name }}
								</NuxtLink>
							</td>
							<td class="p-2 tabular-nums">{{ row.views }}</td>
							<td class="p-2 tabular-nums">{{ row.unique }}</td>
							<td class="p-2 tabular-nums">{{ formatMs(row.avgActiveMs) }}</td>
							<td class="p-2 tabular-nums">{{ formatPercent(row.completionRate) }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<section class="rounded border border-default p-3">
			<div class="flex items-center justify-between mb-2">
				<h3 class="text-sm font-medium text-highlighted">Top Downloads</h3>
				<span class="text-xs text-muted tabular-nums">
					{{ (data?.downloads.total ?? 0).toLocaleString() }} total
				</span>
			</div>
			<div
				v-if="pending"
				class="h-32"
			>
				<USkeleton class="h-full w-full" />
			</div>
			<div
				v-else-if="!data || data.downloads.top.length === 0"
				class="text-muted text-center py-6 text-sm"
			>
				No downloads tracked yet.
			</div>
			<div
				v-else
				class="overflow-x-auto"
			>
				<table class="min-w-full text-sm">
					<thead class="text-left text-muted">
						<tr>
							<th class="p-2">Adapter</th>
							<th class="p-2">Total</th>
							<th class="p-2">Config</th>
							<th class="p-2">Weights</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in data.downloads.top"
							:key="row.slug"
							class="border-t border-default"
						>
							<td class="p-2 max-w-xs truncate">
								<NuxtLink
									:to="`/adapters/${row.slug}`"
									class="hover:underline"
								>
									{{ row.name }}
								</NuxtLink>
							</td>
							<td class="p-2 tabular-nums">{{ row.total }}</td>
							<td class="p-2 tabular-nums">{{ row.byAsset?.config ?? 0 }}</td>
							<td class="p-2 tabular-nums">{{ row.byAsset?.weights ?? 0 }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</section>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
			<BreakdownCard
				title="Referrers"
				:counts="data?.refs ?? {}"
				:loading="pending"
			/>
			<BreakdownCard
				title="Devices"
				:counts="data?.devices ?? {}"
				:loading="pending"
			/>
			<BreakdownCard
				title="Browsers"
				:counts="data?.browsers ?? {}"
				:loading="pending"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
type Summary = {
	range: string;
	from: string;
	to: string;
	kpis: {
		views: { value: number; prev: number };
		unique: { value: number; prev: number };
		avgActiveMs: { value: number; prev: number };
		completionRate: { value: number; prev: number };
	};
	perDay: { day: string; views: number; unique: number }[];
	topAdapters: {
		slug: string;
		name: string;
		views: number;
		unique: number;
		avgActiveMs: number;
		completionRate: number;
	}[];
	downloads: {
		total: number;
		top: { slug: string; name: string; total: number; byAsset: Record<string, number> }[];
	};
	refs: Record<string, number>;
	devices: Record<string, number>;
	browsers: Record<string, number>;
};

const range = ref<'7d' | '30d' | '90d' | 'all'>('7d');
const rangeOptions = [
	{ label: '7d', value: '7d' },
	{ label: '30d', value: '30d' },
	{ label: '90d', value: '90d' },
	{ label: 'All', value: 'all' }
];

const { data, pending, refresh } = useFetch<Summary>(
	() => `/api/analytics/summary?range=${range.value}`,
	{
		credentials: 'include',
		lazy: true,
		server: false
	}
);

function formatMs(ms: number) {
	if (!ms) return '0s';
	if (ms < 1000) return `${ms}ms`;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${s % 60}s`;
}

function formatPercent(v: number) {
	return `${Math.round(v * 100)}%`;
}
</script>
