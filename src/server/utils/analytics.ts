import { kv } from 'hub:kv';

export type RawEvent = {
	slug: string;
	ts: number;
	vid: string;
	active: number;
	depth: 0 | 25 | 50 | 75 | 100;
	referrer: 'external' | 'internal' | 'direct';
	prevSlug?: string;
	device: 'mobile' | 'tablet' | 'desktop';
	browser: string;
	isExit: boolean;
};

export type DailyRollup = {
	day: string;
	views: number;
	vids: string[];
	activeSum: number;
	activeSamples: number;
	depth: { 25: number; 50: number; 75: number; 100: number };
	refs: Record<string, number>;
	devices: Record<string, number>;
	browsers: Record<string, number>;
	bySlug: Record<string, { views: number; vids: string[]; activeSum: number; depth100: number }>;
};

const MAX_VIDS_PER_DAY = 8000;

// slug here is an adapter slug
const dayKey = (slug: string, day: string) => `mylora:evt:${day}:${slug}`;
const rollupKey = (day: string) => `mylora:rollup:${day}`;
const INDEX_KEY = 'mylora:slugs';

// per-adapter download rollup, keyed by adapter id
const dlKey = (day: string, adapterId: string) => `mylora:dl:${day}:${adapterId}`;

export function todayUTC(): string {
	const d = new Date();
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function daysAgoUTC(n: number): string {
	const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function* dayRange(fromDay: string, toDay: string): Generator<string> {
	let cur = new Date(`${fromDay}T00:00:00.000Z`);
	const end = new Date(`${toDay}T00:00:00.000Z`);
	while (cur <= end) {
		yield `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`;
		cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
	}
}

async function loadSlugs(): Promise<string[]> {
	const raw = await kv.get<string>(INDEX_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export async function recordSlug(slug: string) {
	const existing = await loadSlugs();
	if (existing.includes(slug)) return;
	existing.push(slug);
	await kv.set(INDEX_KEY, JSON.stringify(existing));
}

export async function getSlugs(): Promise<string[]> {
	return loadSlugs();
}

export async function writeEvent(day: string, evt: RawEvent) {
	const id = crypto.randomUUID().replace(/-/g, '');
	const key = `${dayKey(evt.slug, day)}:${id}`;
	await kv.set(key, JSON.stringify(evt), { ttl: 60 * 60 * 24 * 90 });
}

async function listRawEventsForDay(day: string): Promise<RawEvent[]> {
	const slugs = await loadSlugs();
	const events: RawEvent[] = [];
	for (const slug of slugs) {
		const prefix = `${dayKey(slug, day)}:`;
		let keys: string[] = [];
		try {
			keys = await kv.keys(prefix);
		} catch {
			keys = [];
		}
		for (const k of keys) {
			const raw = await kv.get<string>(k);
			if (!raw) continue;
			try {
				const evt = typeof raw === 'string' ? (JSON.parse(raw) as RawEvent) : (raw as RawEvent);
				events.push(evt);
			} catch {}
		}
	}
	return events;
}

function emptyRollup(day: string): DailyRollup {
	return {
		day,
		views: 0,
		vids: [],
		activeSum: 0,
		activeSamples: 0,
		depth: { 25: 0, 50: 0, 75: 0, 100: 0 },
		refs: {},
		devices: {},
		browsers: {},
		bySlug: {}
	};
}

export function foldEvents(day: string, events: RawEvent[]): DailyRollup {
	const r = emptyRollup(day);
	const seen = new Set<string>();
	for (const e of events) {
		r.views++;
		if (!seen.has(e.vid) && seen.size < MAX_VIDS_PER_DAY) {
			seen.add(e.vid);
			r.vids.push(e.vid);
		}
		if (e.active > 0) {
			r.activeSum += e.active;
			r.activeSamples++;
		}
		if (e.depth >= 25) r.depth[25]++;
		if (e.depth >= 50) r.depth[50]++;
		if (e.depth >= 75) r.depth[75]++;
		if (e.depth >= 100) r.depth[100]++;
		r.refs[e.referrer] = (r.refs[e.referrer] || 0) + 1;
		r.devices[e.device] = (r.devices[e.device] || 0) + 1;
		r.browsers[e.browser] = (r.browsers[e.browser] || 0) + 1;
		const slugBucket = r.bySlug[e.slug] || { views: 0, vids: [], activeSum: 0, depth100: 0 };
		slugBucket.views++;
		if (!slugBucket.vids.includes(e.vid) && slugBucket.vids.length < MAX_VIDS_PER_DAY) {
			slugBucket.vids.push(e.vid);
		}
		slugBucket.activeSum += Math.max(0, e.active || 0);
		if (e.depth === 100) slugBucket.depth100++;
		r.bySlug[e.slug] = slugBucket;
	}
	return r;
}

async function deleteRawEventsForDay(day: string) {
	const slugs = await loadSlugs();
	for (const slug of slugs) {
		const prefix = `${dayKey(slug, day)}:`;
		let keys: string[] = [];
		try {
			keys = await kv.keys(prefix);
		} catch {
			keys = [];
		}
		for (const k of keys) {
			try {
				await kv.del(k);
			} catch {}
		}
	}
}

export async function getOrBuildRollup(day: string): Promise<DailyRollup> {
	const isToday = day === todayUTC();
	if (!isToday) {
		const cached = await kv.get<string>(rollupKey(day));
		if (cached) {
			try {
				return JSON.parse(cached) as DailyRollup;
			} catch {}
		}
	}
	const events = await listRawEventsForDay(day);
	const r = foldEvents(day, events);
	if (!isToday) {
		try {
			await kv.set(rollupKey(day), JSON.stringify(r));
			await deleteRawEventsForDay(day);
		} catch (e) {
			console.warn('rollup compaction failed', e);
		}
	}
	return r;
}

export function rangeFromQuery(range: string | undefined): number {
	switch (range) {
		case '30d':
			return 30;
		case '90d':
			return 90;
		case 'all':
			return 365;
		default:
			return 7;
	}
}

// inference analytics: per-day rollup of inference runs, broken down by base model and by audience
// (developer = logged-in tester/playground, public = anonymous widget)
const inferKey = (day: string) => `mylora:infer:${day}`;

export type InferenceRollup = {
	total: number;
	byModel: Record<string, number>;
	byAudience: Record<string, number>;
};

function parseInferRollup(raw: unknown): InferenceRollup {
	const r: InferenceRollup = { total: 0, byModel: {}, byAudience: {} };
	if (!raw) return r;
	try {
		const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (p && typeof p === 'object') {
			r.total = Number(p.total) || 0;
			if (p.byModel && typeof p.byModel === 'object') r.byModel = p.byModel;
			if (p.byAudience && typeof p.byAudience === 'object') r.byAudience = p.byAudience;
		}
	} catch {}
	return r;
}

export async function recordInference(
	day: string,
	opts: { model: string; audience: 'public' | 'developer' }
) {
	const key = inferKey(day);
	try {
		const r = parseInferRollup(await kv.get<string>(key));
		r.total++;
		const model = opts.model || 'unknown';
		r.byModel[model] = (r.byModel[model] || 0) + 1;
		r.byAudience[opts.audience] = (r.byAudience[opts.audience] || 0) + 1;
		await kv.set(key, JSON.stringify(r));
	} catch {}
}

export type InferenceAnalytics = {
	total: number;
	perDay: { day: string; total: number }[];
	byModel: Record<string, number>;
	byAudience: Record<string, number>;
};

// sum inference rollups across a day range into a series + model/audience breakdowns
export async function getInferenceAnalytics(
	fromDay: string,
	toDay: string
): Promise<InferenceAnalytics> {
	const perDay: { day: string; total: number }[] = [];
	const byModel: Record<string, number> = {};
	const byAudience: Record<string, number> = {};
	let total = 0;
	for (const day of dayRange(fromDay, toDay)) {
		let raw: string | null = null;
		try {
			raw = await kv.get<string>(inferKey(day));
		} catch {
			raw = null;
		}
		const r = parseInferRollup(raw);
		perDay.push({ day, total: r.total });
		total += r.total;
		for (const [k, v] of Object.entries(r.byModel)) byModel[k] = (byModel[k] || 0) + (v as number);
		for (const [k, v] of Object.entries(r.byAudience))
			byAudience[k] = (byAudience[k] || 0) + (v as number);
	}
	return { total, perDay, byModel, byAudience };
}

// sum just the total inference count across a day range (used for the previous-period kpi delta)
export async function getInferenceTotal(fromDay: string, toDay: string): Promise<number> {
	let total = 0;
	for (const day of dayRange(fromDay, toDay)) {
		try {
			total += parseInferRollup(await kv.get<string>(inferKey(day))).total;
		} catch {}
	}
	return total;
}

// training analytics: per-day rollup of training-job starts + outcomes (timing, machine/gpu, engine,
// model, status). pure apply* helpers fold one event into a rollup so they are unit-testable.
const trainKey = (day: string) => `mylora:train:${day}`;

export type TrainingRollup = {
	started: number;
	completed: number;
	failed: number; // failed + abnormal
	aborted: number;
	// finished jobs with a known wall-clock duration (seconds)
	durationSum: number;
	durationSamples: number;
	// sum of the up-front estimates for those same samples (for estimate-accuracy)
	etaSum: number;
	byEngine: Record<string, number>; // starts
	byModel: Record<string, number>; // starts
	byStatus: Record<string, number>; // terminal outcomes
	byGpu: Record<string, number>; // finished, by gpu name
};

export function emptyTrainingRollup(): TrainingRollup {
	return {
		started: 0,
		completed: 0,
		failed: 0,
		aborted: 0,
		durationSum: 0,
		durationSamples: 0,
		etaSum: 0,
		byEngine: {},
		byModel: {},
		byStatus: {},
		byGpu: {}
	};
}

function parseTrainingRollup(raw: unknown): TrainingRollup {
	const r = emptyTrainingRollup();
	if (!raw) return r;
	try {
		const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (p && typeof p === 'object') {
			r.started = Number(p.started) || 0;
			r.completed = Number(p.completed) || 0;
			r.failed = Number(p.failed) || 0;
			r.aborted = Number(p.aborted) || 0;
			r.durationSum = Number(p.durationSum) || 0;
			r.durationSamples = Number(p.durationSamples) || 0;
			r.etaSum = Number(p.etaSum) || 0;
			for (const k of ['byEngine', 'byModel', 'byStatus', 'byGpu'] as const) {
				if (p[k] && typeof p[k] === 'object') r[k] = p[k];
			}
		}
	} catch {}
	return r;
}

// fold a job start into a rollup (pure)
export function applyTrainingStart(
	r: TrainingRollup,
	o: { engine: string; model: string }
): TrainingRollup {
	r.started++;
	r.byEngine[o.engine] = (r.byEngine[o.engine] || 0) + 1;
	const model = o.model || 'unknown';
	r.byModel[model] = (r.byModel[model] || 0) + 1;
	return r;
}

// fold a terminal outcome into a rollup (pure)
export function applyTrainingFinish(
	r: TrainingRollup,
	o: {
		status: string;
		gpu?: string | null;
		durationSeconds?: number | null;
		etaSeconds?: number | null;
	}
): TrainingRollup {
	r.byStatus[o.status] = (r.byStatus[o.status] || 0) + 1;
	if (o.status === 'completed') r.completed++;
	else if (o.status === 'failed' || o.status === 'abnormal') r.failed++;
	else if (o.status === 'aborted') r.aborted++;
	const gpu = o.gpu || 'unknown';
	r.byGpu[gpu] = (r.byGpu[gpu] || 0) + 1;
	if (o.durationSeconds && o.durationSeconds > 0) {
		r.durationSum += o.durationSeconds;
		r.durationSamples++;
		if (o.etaSeconds && o.etaSeconds > 0) r.etaSum += o.etaSeconds;
	}
	return r;
}

export async function recordTrainingStart(day: string, o: { engine: string; model: string }) {
	const key = trainKey(day);
	try {
		const r = applyTrainingStart(parseTrainingRollup(await kv.get<string>(key)), o);
		await kv.set(key, JSON.stringify(r));
	} catch {}
}

export async function recordTrainingFinish(
	day: string,
	o: {
		status: string;
		gpu?: string | null;
		durationSeconds?: number | null;
		etaSeconds?: number | null;
	}
) {
	const key = trainKey(day);
	try {
		const r = applyTrainingFinish(parseTrainingRollup(await kv.get<string>(key)), o);
		await kv.set(key, JSON.stringify(r));
	} catch {}
}

export type TrainingAnalytics = {
	started: number;
	completed: number;
	failed: number;
	aborted: number;
	successRate: number; // completed / finished
	avgDurationSeconds: number;
	totalTrainingSeconds: number; // proxy for gpu-time spent
	etaRatio: number | null; // actual / estimated (>1 = slower than estimated)
	perDay: { day: string; started: number; completed: number; failed: number }[];
	byEngine: Record<string, number>;
	byModel: Record<string, number>;
	byStatus: Record<string, number>;
	byGpu: Record<string, number>;
};

export async function getTrainingAnalytics(
	fromDay: string,
	toDay: string
): Promise<TrainingAnalytics> {
	const agg = emptyTrainingRollup();
	const perDay: { day: string; started: number; completed: number; failed: number }[] = [];
	for (const day of dayRange(fromDay, toDay)) {
		let raw: string | null = null;
		try {
			raw = await kv.get<string>(trainKey(day));
		} catch {
			raw = null;
		}
		const r = parseTrainingRollup(raw);
		perDay.push({ day, started: r.started, completed: r.completed, failed: r.failed });
		agg.started += r.started;
		agg.completed += r.completed;
		agg.failed += r.failed;
		agg.aborted += r.aborted;
		agg.durationSum += r.durationSum;
		agg.durationSamples += r.durationSamples;
		agg.etaSum += r.etaSum;
		for (const k of ['byEngine', 'byModel', 'byStatus', 'byGpu'] as const) {
			for (const [kk, v] of Object.entries(r[k])) agg[k][kk] = (agg[k][kk] || 0) + (v as number);
		}
	}
	const finished = agg.completed + agg.failed + agg.aborted;
	return {
		started: agg.started,
		completed: agg.completed,
		failed: agg.failed,
		aborted: agg.aborted,
		successRate: finished ? agg.completed / finished : 0,
		avgDurationSeconds: agg.durationSamples ? Math.round(agg.durationSum / agg.durationSamples) : 0,
		totalTrainingSeconds: agg.durationSum,
		etaRatio: agg.etaSum > 0 ? agg.durationSum / agg.etaSum : null,
		perDay,
		byEngine: agg.byEngine,
		byModel: agg.byModel,
		byStatus: agg.byStatus,
		byGpu: agg.byGpu
	};
}

// download analytics: simple per-adapter daily counter in KV; used by the downloads api
export async function recordDownload(day: string, adapterId: string, asset: string) {
	const key = dlKey(day, adapterId);
	try {
		const raw = await kv.get<string>(key);
		let counts: Record<string, number> = {};
		if (raw) {
			try {
				const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
				if (parsed && typeof parsed === 'object') counts = parsed as Record<string, number>;
			} catch {}
		}
		counts.total = (counts.total || 0) + 1;
		counts[asset] = (counts[asset] || 0) + 1;
		await kv.set(key, JSON.stringify(counts));
	} catch {}
}

export type DownloadTotal = {
	total: number;
	byAsset: Record<string, number>;
};

// sum per-adapter download counts across a day range
export async function getDownloadTotals(
	adapterIds: string[],
	fromDay: string,
	toDay: string
): Promise<Record<string, DownloadTotal>> {
	const out: Record<string, DownloadTotal> = {};
	for (const id of adapterIds) {
		out[id] = { total: 0, byAsset: {} };
	}
	for (const day of dayRange(fromDay, toDay)) {
		for (const id of adapterIds) {
			let raw: string | null = null;
			try {
				raw = await kv.get<string>(dlKey(day, id));
			} catch {
				raw = null;
			}
			if (!raw) continue;
			let counts: Record<string, number> = {};
			try {
				const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
				if (parsed && typeof parsed === 'object') counts = parsed as Record<string, number>;
			} catch {
				continue;
			}

			const bucket = out[id];
			if (!bucket) continue; // should never happen

			for (const k of Object.keys(counts)) {
				if (k === 'total') {
					bucket.total += counts[k] || 0;
				} else {
					bucket.byAsset[k] = (bucket.byAsset[k] || 0) + (counts[k] || 0);
				}
			}
		}
	}
	return out;
}
