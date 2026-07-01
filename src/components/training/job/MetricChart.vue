<template>
	<div
		v-if="ok"
		class="space-y-1.5"
	>
		<div class="flex flex-wrap items-center justify-between gap-2 text-xs">
			<span class="font-medium text-toned">{{ title }}</span>
			<div class="flex items-center gap-2">
				<span
					v-if="finalLabel"
					class="font-mono text-muted"
					>{{ finalLabel }}</span
				>
				<USelect
					:model-value="zoom"
					:items="zoomItems"
					value-key="value"
					size="xs"
					class="w-20"
					aria-label="Zoom"
					@update:model-value="setZoom($event)"
				/>
				<UButton
					icon="mdi:download"
					size="xs"
					variant="ghost"
					color="neutral"
					title="Download SVG"
					aria-label="Download SVG"
					@click="downloadSvg"
				/>
			</div>
		</div>
		<!-- relative wrapper anchors the popover trigger over the selected point -->
		<div class="relative">
			<div class="overflow-x-auto">
				<svg
					ref="svgEl"
					class="h-auto block"
					:style="{ width: `${zoom * 100}%` }"
					:viewBox="`0 0 ${W} ${H}`"
					role="img"
					:aria-label="`${title} chart`"
				>
					<!-- y axis label across the top of the plot -->
					<text
						:x="PAD_L"
						:y="10"
						fill="currentColor"
						class="text-muted text-[8px]"
					>
						{{ yLabel }}
					</text>

					<!-- gridlines + y tick labels (muted, low opacity) -->
					<g class="text-muted">
						<line
							v-for="t in yTicks"
							:key="`yg-${t.v}`"
							:x1="PAD_L"
							:y1="t.py"
							:x2="W - PAD_R"
							:y2="t.py"
							stroke="currentColor"
							stroke-width="0.5"
							opacity="0.25"
						/>
						<text
							v-for="t in yTicks"
							:key="`yl-${t.v}`"
							:x="PAD_L - 4"
							:y="t.py + 2.5"
							text-anchor="end"
							fill="currentColor"
							class="text-muted text-[7px]"
						>
							{{ yFmt(t.v) }}
						</text>
					</g>

					<!-- axis lines (left + bottom of plot area) -->
					<g class="text-muted">
						<line
							:x1="PAD_L"
							:y1="PAD_T"
							:x2="PAD_L"
							:y2="H - PAD_B"
							stroke="currentColor"
							stroke-width="0.75"
							opacity="0.5"
						/>
						<line
							:x1="PAD_L"
							:y1="H - PAD_B"
							:x2="W - PAD_R"
							:y2="H - PAD_B"
							stroke="currentColor"
							stroke-width="0.75"
							opacity="0.5"
						/>
					</g>

					<!-- x tick labels -->
					<g class="text-muted">
						<text
							v-for="t in xTicks"
							:key="`xl-${t.v}`"
							:x="t.px"
							:y="H - PAD_B + 9"
							:text-anchor="t.anchor"
							fill="currentColor"
							class="text-muted text-[7px]"
						>
							{{ xFmt(t.v) }}
						</text>
					</g>

					<!-- x axis title centered under the ticks -->
					<text
						:x="PAD_L + plotW / 2"
						:y="H - 2"
						text-anchor="middle"
						fill="currentColor"
						class="text-muted text-[8px]"
					>
						{{ xLabel }}
					</text>

					<!-- data line + per-point markers (color via currentColor on the colored group) -->
					<g :class="color">
						<polyline
							:points="linePoints"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							vector-effect="non-scaling-stroke"
							stroke-linejoin="round"
							stroke-linecap="round"
						/>
						<!-- markers thinned when the series is dense (line still uses all points) -->
						<g
							v-for="m in markers"
							:key="`pt-${m.i}`"
							class="point"
							@click="select(m.i)"
						>
							<!-- native tooltip on the whole point group (so the big hit target below shows it) -->
							<title>{{ xLabel }} {{ xFmt(m.x) }} - {{ yLabel }} {{ yFmt(m.y) }}</title>
							<!-- visible marker (ignores pointer events so the hit target drives hover) -->
							<circle
								:cx="m.px"
								:cy="m.py"
								r="2.5"
								fill="currentColor"
								class="marker"
							/>
							<!-- enlarged transparent hit target so the dot is easy to hover -->
							<circle
								:cx="m.px"
								:cy="m.py"
								r="10"
								fill="transparent"
								class="hit"
							/>
						</g>
					</g>
				</svg>
			</div>

			<!-- popover anchored at the selected point via an absolutely-positioned invisible trigger -->
			<UPopover
				:open="selected != null"
				@update:open="
					(v: boolean) => {
						if (!v) selected = null;
					}
				"
			>
				<div
					v-if="selectedCoord"
					class="absolute w-px h-px pointer-events-none"
					:style="{ left: `${selectedCoord.leftPct}%`, top: `${selectedCoord.topPct}%` }"
					aria-hidden="true"
				/>
				<template #content>
					<div class="p-2 text-xs space-y-0.5">
						<p class="font-mono">
							<span class="text-muted">{{ xLabel }}:</span> {{ xFmt(displayCoord?.x ?? 0) }}
						</p>
						<p class="font-mono">
							<span class="text-muted">{{ yLabel }}:</span> {{ yFmt(displayCoord?.y ?? 0) }}
						</p>
					</div>
				</template>
			</UPopover>
		</div>
		<p class="text-xs text-muted">{{ legend }}</p>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		points: { x: number; y: number }[];
		title: string;
		xLabel: string;
		yLabel: string;
		color?: string;
		legend: string;
		xFormat?: (n: number) => string;
		yFormat?: (n: number) => string;
		finalLabel?: string;
	}>(),
	{ color: 'text-primary' }
);

// fixed viewBox + margins (left for y ticks, bottom for x ticks + axis title, small top)
const W = 320;
const H = 170;
const PAD_L = 44;
const PAD_R = 10;
const PAD_T = 16;
const PAD_B = 26;
const plotW = W - PAD_L - PAD_R;
const plotH = H - PAD_T - PAD_B;

// trimmed-number default formatter (drops trailing zeros)
function trim(n: number): string {
	if (!Number.isFinite(n)) return '';
	return Number(n.toFixed(4)).toString();
}
const xFmt = (n: number) => (props.xFormat ? props.xFormat(n) : trim(n));
const yFmt = (n: number) => (props.yFormat ? props.yFormat(n) : trim(n));

// only render with >= 2 points
const ok = computed(() => props.points.length >= 2);

const xs = computed(() => props.points.map((p) => p.x));
const ys = computed(() => props.points.map((p) => p.y));

const xMin = computed(() => Math.min(...xs.value));
const xMax = computed(() => Math.max(...xs.value));
const yMin = computed(() => Math.min(...ys.value));
const yMax = computed(() => Math.max(...ys.value));

// map data x -> px across the x-range (center when all equal)
function mapX(x: number): number {
	const span = xMax.value - xMin.value;
	if (span === 0) return PAD_L + plotW / 2;
	return PAD_L + ((x - xMin.value) / span) * plotW;
}
// map data y -> px, inverted (larger y higher), with a little padding on the range
function mapY(y: number): number {
	let lo = yMin.value;
	let hi = yMax.value;
	let span = hi - lo;
	if (span === 0) {
		// flat series -> center the line, give it a visible band
		lo -= 1;
		hi += 1;
		span = 2;
	}
	const pad = span * 0.08;
	lo -= pad;
	hi += pad;
	span = hi - lo;
	return PAD_T + (1 - (y - lo) / span) * plotH;
}

const coords = computed(() =>
	props.points.map((p) => ({ x: p.x, y: p.y, px: mapX(p.x), py: mapY(p.y) }))
);
const linePoints = computed(() =>
	coords.value.map((c) => `${c.px.toFixed(2)},${c.py.toFixed(2)}`).join(' ')
);

// thin markers when dense so hit targets do not overlap; keep first + last, step through the rest
const MARKER_LIMIT = 60;
const markers = computed(() => {
	const cs = coords.value;
	if (cs.length <= MARKER_LIMIT) return cs.map((c, i) => ({ ...c, i }));
	const step = Math.ceil(cs.length / MARKER_LIMIT);
	const out: { x: number; y: number; px: number; py: number; i: number }[] = [];
	for (let i = 0; i < cs.length; i += step) out.push({ ...cs[i]!, i });
	const last = cs.length - 1;
	if (out[out.length - 1]?.i !== last) out.push({ ...cs[last]!, i: last });
	return out;
});

// y axis: 3 ticks (min, mid, max) using the padded range so labels match the gridlines
const yTicks = computed(() => {
	let lo = yMin.value;
	let hi = yMax.value;
	if (hi - lo === 0) {
		lo -= 1;
		hi += 1;
	}
	const mid = (lo + hi) / 2;
	return [hi, mid, lo].map((v) => ({ v, py: mapY(v) }));
});

// x axis: 2-6 evenly spaced ticks (always first + last), capped for dense series
const xTicks = computed(() => {
	const lo = xMin.value;
	const hi = xMax.value;
	if (hi - lo === 0) return [{ v: lo, px: mapX(lo), anchor: 'middle' as const }];
	const cap = props.points.length > MARKER_LIMIT ? 6 : 4;
	const n = Math.min(cap, Math.max(2, props.points.length));
	const out: { v: number; px: number; anchor: 'start' | 'middle' | 'end' }[] = [];
	for (let i = 0; i < n; i++) {
		const v = lo + ((hi - lo) * i) / (n - 1);
		const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
		out.push({ v, px: mapX(v), anchor });
	}
	return out;
});

// zoom scales the rendered svg width inside the scroll container (viewBox unchanged)
const zoom = ref(1);
const zoomItems = [
	{ label: '0.25x', value: 0.25 },
	{ label: '0.5x', value: 0.5 },
	{ label: '1x', value: 1 },
	{ label: '2x', value: 2 },
	{ label: '4x', value: 4 }
];
function setZoom(v: unknown) {
	const n = Number(v);
	if (Number.isFinite(n)) zoom.value = n;
}

// popover: track selected point index, anchor a trigger over its %-coords within the plot
const selected = ref<number | null>(null);
function select(i: number) {
	selected.value = selected.value === i ? null : i;
}
const selectedCoord = computed(() => {
	if (selected.value == null) return null;
	const c = coords.value[selected.value];
	if (!c) return null;
	return { x: c.x, y: c.y, leftPct: (c.px / W) * 100, topPct: (c.py / H) * 100 };
});
// retain the last selected values so the popover content does not flash to 0 while it closes (the
// content stays mounted through the close animation after `selected` clears)
const displayCoord = ref<{ x: number; y: number } | null>(null);
watch(selectedCoord, (c) => {
	if (c) displayCoord.value = { x: c.x, y: c.y };
});

// serialize the live inline svg and download it (client-only)
const svgEl = ref<SVGSVGElement | null>(null);
function downloadSvg() {
	if (!import.meta.client || typeof document === 'undefined' || !svgEl.value) return;
	const src = new XMLSerializer().serializeToString(svgEl.value);
	const blob = new Blob([src], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${props.title}-chart.svg`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
</script>

<style scoped>
.marker {
	transition: r 0.1s ease;
	pointer-events: none;
}
/* the transparent hit target captures hover; enlarge the sibling marker for affordance */
.point:hover .marker {
	r: 4;
}
.hit {
	cursor: pointer;
}
</style>
