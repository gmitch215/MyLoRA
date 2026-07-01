import { beforeAll, describe, expect, it, vi } from 'vitest';

// analytics.ts imports `hub:kv` at module load; only the pure fold/format helpers are tested here
vi.mock('hub:kv', () => ({
	kv: { get: vi.fn(), set: vi.fn(), keys: vi.fn(), del: vi.fn() }
}));

let mod: typeof import('../../../src/server/utils/analytics');

beforeAll(async () => {
	mod = await import('../../../src/server/utils/analytics');
});

function evt(over: Partial<import('../../../src/server/utils/analytics').RawEvent> = {}) {
	return {
		slug: 'a',
		ts: 0,
		vid: 'v1',
		active: 10,
		depth: 100,
		referrer: 'direct',
		device: 'desktop',
		browser: 'chrome',
		isExit: false,
		...over
	} as import('../../../src/server/utils/analytics').RawEvent;
}

describe('date helpers', () => {
	it('todayUTC is a YYYY-MM-DD string', () => {
		expect(mod.todayUTC()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('daysAgoUTC(0) equals todayUTC', () => {
		expect(mod.daysAgoUTC(0)).toBe(mod.todayUTC());
	});

	it('daysAgoUTC returns a valid earlier day', () => {
		expect(mod.daysAgoUTC(7)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(mod.daysAgoUTC(7) < mod.todayUTC()).toBe(true);
	});

	it('dayRange is inclusive of both ends', () => {
		expect([...mod.dayRange('2026-01-01', '2026-01-03')]).toEqual([
			'2026-01-01',
			'2026-01-02',
			'2026-01-03'
		]);
	});

	it('dayRange spans a month/year boundary', () => {
		expect([...mod.dayRange('2025-12-31', '2026-01-01')]).toEqual(['2025-12-31', '2026-01-01']);
	});

	it('dayRange yields a single day when from == to', () => {
		expect([...mod.dayRange('2026-05-05', '2026-05-05')]).toEqual(['2026-05-05']);
	});

	it('dayRange yields nothing when from > to', () => {
		expect([...mod.dayRange('2026-05-05', '2026-05-04')]).toEqual([]);
	});
});

describe('rangeFromQuery', () => {
	it('maps known ranges', () => {
		expect(mod.rangeFromQuery('30d')).toBe(30);
		expect(mod.rangeFromQuery('90d')).toBe(90);
		expect(mod.rangeFromQuery('all')).toBe(365);
	});

	it('defaults to 7 for undefined/unknown', () => {
		expect(mod.rangeFromQuery(undefined)).toBe(7);
		expect(mod.rangeFromQuery('7d')).toBe(7);
		expect(mod.rangeFromQuery('garbage')).toBe(7);
	});
});

describe('foldEvents', () => {
	it('empties out on no events', () => {
		const r = mod.foldEvents('2026-01-01', []);
		expect(r).toMatchObject({ day: '2026-01-01', views: 0, vids: [], activeSum: 0 });
	});

	it('counts views, dedupes vids and folds depth thresholds', () => {
		const r = mod.foldEvents('d', [
			evt({ vid: 'v1', depth: 100, active: 5 }),
			evt({ vid: 'v1', depth: 50, active: 0 }),
			evt({ vid: 'v2', depth: 25, active: 3 })
		]);
		expect(r.views).toBe(3);
		expect(r.vids.sort()).toEqual(['v1', 'v2']);
		// depth is cumulative: >=25 counts all three, >=50 counts two, >=100 counts one
		expect(r.depth[25]).toBe(3);
		expect(r.depth[50]).toBe(2);
		expect(r.depth[75]).toBe(1);
		expect(r.depth[100]).toBe(1);
		// active only sampled when > 0
		expect(r.activeSum).toBe(8);
		expect(r.activeSamples).toBe(2);
	});

	it('buckets refs/devices/browsers', () => {
		const r = mod.foldEvents('d', [
			evt({ referrer: 'external', device: 'mobile', browser: 'safari' }),
			evt({ referrer: 'external', device: 'desktop', browser: 'chrome' })
		]);
		expect(r.refs.external).toBe(2);
		expect(r.devices.mobile).toBe(1);
		expect(r.devices.desktop).toBe(1);
		expect(r.browsers.safari).toBe(1);
	});

	it('tracks per-slug buckets with depth100 and deduped vids', () => {
		const r = mod.foldEvents('d', [
			evt({ slug: 'x', vid: 'v1', depth: 100, active: 4 }),
			evt({ slug: 'x', vid: 'v1', depth: 50, active: -3 }),
			evt({ slug: 'y', vid: 'v2', depth: 100, active: 2 })
		]);
		expect(r.bySlug.x.views).toBe(2);
		expect(r.bySlug.x.vids).toEqual(['v1']);
		expect(r.bySlug.x.depth100).toBe(1);
		// negative active clamped to 0 in the per-slug sum
		expect(r.bySlug.x.activeSum).toBe(4);
		expect(r.bySlug.y.depth100).toBe(1);
	});
});

describe('training rollup fold helpers', () => {
	it('emptyTrainingRollup starts at zero', () => {
		const r = mod.emptyTrainingRollup();
		expect(r.started).toBe(0);
		expect(r.byEngine).toEqual({});
	});

	it('applyTrainingStart bumps started + engine/model buckets', () => {
		let r = mod.emptyTrainingRollup();
		r = mod.applyTrainingStart(r, { engine: 'peft', model: 'llama' });
		r = mod.applyTrainingStart(r, { engine: 'peft', model: '' });
		expect(r.started).toBe(2);
		expect(r.byEngine.peft).toBe(2);
		expect(r.byModel.llama).toBe(1);
		// empty model bucketed as unknown
		expect(r.byModel.unknown).toBe(1);
	});

	it('applyTrainingFinish tallies completed and timing', () => {
		let r = mod.emptyTrainingRollup();
		r = mod.applyTrainingFinish(r, {
			status: 'completed',
			gpu: 'A100',
			durationSeconds: 120,
			etaSeconds: 100
		});
		expect(r.completed).toBe(1);
		expect(r.byStatus.completed).toBe(1);
		expect(r.byGpu.A100).toBe(1);
		expect(r.durationSum).toBe(120);
		expect(r.durationSamples).toBe(1);
		expect(r.etaSum).toBe(100);
	});

	it('applyTrainingFinish maps failed/abnormal/aborted', () => {
		let r = mod.emptyTrainingRollup();
		r = mod.applyTrainingFinish(r, { status: 'failed' });
		r = mod.applyTrainingFinish(r, { status: 'abnormal' });
		r = mod.applyTrainingFinish(r, { status: 'aborted' });
		expect(r.failed).toBe(2); // failed + abnormal
		expect(r.aborted).toBe(1);
		// no gpu -> unknown, no duration -> no samples
		expect(r.byGpu.unknown).toBe(3);
		expect(r.durationSamples).toBe(0);
	});

	it('applyTrainingFinish ignores zero/negative durations and eta without duration', () => {
		let r = mod.emptyTrainingRollup();
		r = mod.applyTrainingFinish(r, { status: 'completed', durationSeconds: 0, etaSeconds: 50 });
		r = mod.applyTrainingFinish(r, { status: 'completed', durationSeconds: 90, etaSeconds: 0 });
		expect(r.durationSamples).toBe(1);
		expect(r.durationSum).toBe(90);
		// eta only added when both duration and eta are positive
		expect(r.etaSum).toBe(0);
	});
});
