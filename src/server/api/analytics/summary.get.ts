import { inArray, notInArray } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, trainingJobs } from 'hub:db:schema';
import {
	dayRange,
	daysAgoUTC,
	getDownloadTotals,
	getInferenceAnalytics,
	getInferenceTotal,
	getOrBuildRollup,
	getTrainingAnalytics,
	rangeFromQuery,
	todayUTC
} from '~/server/utils/analytics';
import { requireAdmin } from '~/server/utils/auth';
import { ensureDatabase } from '~/server/utils/db';

export default defineEventHandler(async (event) => {
	await requireAdmin(event);
	await ensureDatabase();

	const range = String(getQuery(event).range || '7d');
	const days = rangeFromQuery(range);
	const to = todayUTC();
	const from = daysAgoUTC(days - 1);
	const prevFrom = daysAgoUTC(days * 2 - 1);
	const prevTo = daysAgoUTC(days);

	async function aggregate(fromDay: string, toDay: string) {
		let views = 0;
		const uniqueSet = new Set<string>();
		let activeSum = 0;
		let activeSamples = 0;
		let depth100 = 0;
		const refs: Record<string, number> = {};
		const devices: Record<string, number> = {};
		const browsers: Record<string, number> = {};
		const bySlug: Record<
			string,
			{ views: number; unique: Set<string>; activeSum: number; depth100: number }
		> = {};
		const perDay: { day: string; views: number; unique: number }[] = [];

		for (const day of dayRange(fromDay, toDay)) {
			const r = await getOrBuildRollup(day);
			views += r.views;
			r.vids.forEach((v) => uniqueSet.add(v));
			activeSum += r.activeSum;
			activeSamples += r.activeSamples;
			depth100 += r.depth[100];

			for (const k of Object.keys(r.refs)) refs[k] = (refs[k] || 0) + (r.refs[k] || 0);
			for (const k of Object.keys(r.devices)) devices[k] = (devices[k] || 0) + (r.devices[k] || 0);
			for (const k of Object.keys(r.browsers))
				browsers[k] = (browsers[k] || 0) + (r.browsers[k] || 0);
			for (const slug of Object.keys(r.bySlug)) {
				const bucket = bySlug[slug] || {
					views: 0,
					unique: new Set<string>(),
					activeSum: 0,
					depth100: 0
				};
				const part = r.bySlug[slug];
				if (!part) continue;

				bucket.views += part.views;
				part.vids.forEach((v) => bucket.unique.add(v));
				bucket.activeSum += part.activeSum;
				bucket.depth100 += part.depth100;
				bySlug[slug] = bucket;
			}
			perDay.push({ day, views: r.views, unique: r.vids.length });
		}

		return {
			views,
			unique: uniqueSet.size,
			activeSum,
			activeSamples,
			depth100,
			refs,
			devices,
			browsers,
			bySlug,
			perDay
		};
	}

	const current = await aggregate(from, to);
	const previous = await aggregate(prevFrom, prevTo);

	const slugs = Object.keys(current.bySlug);
	const nameMap: Record<string, string> = {};
	const idMap: Record<string, string> = {};
	if (slugs.length > 0) {
		const rows = await db
			.select({ id: adapters.id, slug: adapters.slug, name: adapters.name })
			.from(adapters)
			.where(inArray(adapters.slug, slugs));
		for (const row of rows) {
			nameMap[row.slug] = row.name;
			idMap[row.slug] = row.id;
		}
	}

	const topAdapters = Object.entries(current.bySlug)
		.map(([slug, b]) => ({
			slug,
			name: nameMap[slug] || slug,
			views: b.views,
			unique: b.unique.size,
			avgActiveMs: b.views > 0 ? Math.round(b.activeSum / b.views) : 0,
			completionRate: b.views > 0 ? b.depth100 / b.views : 0
		}))
		.sort((a, b) => b.views - a.views)
		.slice(0, 25);

	// download totals keyed by adapter id, mapped back to slug + name
	const ids = Object.values(idMap);
	const dlTotals = ids.length > 0 ? await getDownloadTotals(ids, from, to) : {};
	let downloadsTotal = 0;
	const topDownloads = Object.entries(idMap)
		.map(([slug, id]) => {
			const t = dlTotals[id] || { total: 0, byAsset: {} };
			downloadsTotal += t.total;
			return {
				slug,
				name: nameMap[slug] || slug,
				total: t.total,
				byAsset: t.byAsset
			};
		})
		.filter((d) => d.total > 0)
		.sort((a, b) => b.total - a.total)
		.slice(0, 25);

	// inference analytics: time series + breakdowns by model and audience (developer vs public)
	const inf = await getInferenceAnalytics(from, to);
	const prevInfTotal = await getInferenceTotal(prevFrom, prevTo);
	// shorten the long cloudflare model ids to their last path segment for display (merge collisions)
	const inferByModel: Record<string, number> = {};
	for (const [model, count] of Object.entries(inf.byModel)) {
		const short = model.split('/').pop() || model;
		inferByModel[short] = (inferByModel[short] || 0) + count;
	}

	// training analytics: timing + machine/gpu + engine/model/status telemetry over the range, plus a
	// live snapshot of jobs in flight right now (not range-bound)
	const training = await getTrainingAnalytics(from, to);
	const trainByModel: Record<string, number> = {};
	for (const [model, count] of Object.entries(training.byModel)) {
		const short = model.split('/').pop() || model;
		trainByModel[short] = (trainByModel[short] || 0) + count;
	}
	const activeRows = await db
		.select({ status: trainingJobs.status })
		.from(trainingJobs)
		.where(notInArray(trainingJobs.status, ['completed', 'failed', 'abnormal', 'aborted']));
	const activeByStatus: Record<string, number> = {};
	for (const r of activeRows) activeByStatus[r.status] = (activeByStatus[r.status] || 0) + 1;

	const avgActiveMs = current.views > 0 ? Math.round(current.activeSum / current.views) : 0;
	const prevAvgActiveMs = previous.views > 0 ? Math.round(previous.activeSum / previous.views) : 0;
	const completionRate = current.views > 0 ? current.depth100 / current.views : 0;
	const prevCompletionRate = previous.views > 0 ? previous.depth100 / previous.views : 0;

	return {
		range,
		from,
		to,
		kpis: {
			views: { value: current.views, prev: previous.views },
			unique: { value: current.unique, prev: previous.unique },
			avgActiveMs: { value: avgActiveMs, prev: prevAvgActiveMs },
			completionRate: { value: completionRate, prev: prevCompletionRate }
		},
		perDay: current.perDay,
		inferences: {
			total: inf.total,
			prev: prevInfTotal,
			perDay: inf.perDay,
			byModel: inferByModel,
			byAudience: inf.byAudience
		},
		topAdapters,
		downloads: {
			total: downloadsTotal,
			top: topDownloads
		},
		training: {
			started: training.started,
			completed: training.completed,
			failed: training.failed,
			aborted: training.aborted,
			successRate: training.successRate,
			avgDurationSeconds: training.avgDurationSeconds,
			totalTrainingSeconds: training.totalTrainingSeconds,
			etaRatio: training.etaRatio,
			perDay: training.perDay,
			byEngine: training.byEngine,
			byModel: trainByModel,
			byStatus: training.byStatus,
			byGpu: training.byGpu,
			active: activeRows.length,
			activeByStatus
		},
		refs: current.refs,
		devices: current.devices,
		browsers: current.browsers
	};
});
