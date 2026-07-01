import { describe, expect, it } from 'vitest';
import {
	ARCHIVE_INFLATION,
	AT_CAPACITY_VRAM_PCT,
	TERMINAL_JOB_STATUSES,
	TESTABLE_STATUSES,
	doc2loraScopeCovers,
	estimateTrainingSeconds,
	estimatedCorpusBytes,
	formatBytes,
	formatDate,
	formatDateTime,
	isFailedJob,
	isTerminalJob,
	isTestable,
	parsePhaseTimings,
	parseScanEstimateSeconds,
	parseTrainingProgress,
	parseTrainingSeries,
	trainingEtaSeconds,
	type AdapterStatus,
	type JobStatus,
	type TrainingProgress
} from '../../../src/shared/types';

function snap(over: Partial<TrainingProgress> = {}): TrainingProgress {
	return {
		percent: null,
		step: null,
		totalSteps: null,
		epoch: null,
		tqdmRemainingSeconds: null,
		rate: null,
		...over
	};
}

const MB = 1024 * 1024;

// the flat tests/unit/estimate.test.ts + progress.test.ts already cover estimateTrainingSeconds
// monotonicity/devices/quant, formatDuration, and the whole parse* progress family; here we cover the
// simple predicates, corpus inflation, byte/date formatting, and the estimate branches those omit

describe('isTestable', () => {
	it('is true only for testable statuses (published, migrated)', () => {
		for (const s of TESTABLE_STATUSES) expect(isTestable(s)).toBe(true);
		expect(isTestable('published')).toBe(true);
		expect(isTestable('migrated')).toBe(true);
	});

	it('is false for every non-testable status', () => {
		const others: AdapterStatus[] = ['draft', 'listed', 'pushing', 'failed', 'archived'];
		for (const s of others) expect(isTestable(s)).toBe(false);
	});
});

describe('isTerminalJob', () => {
	it('is true for terminal statuses (completed, failed, abnormal, aborted)', () => {
		for (const s of TERMINAL_JOB_STATUSES) expect(isTerminalJob(s)).toBe(true);
	});

	it('is false for in-flight statuses', () => {
		const live: JobStatus[] = [
			'queued',
			'provisioning',
			'launching',
			'running',
			'syncing',
			'verifying',
			'publishing'
		];
		for (const s of live) expect(isTerminalJob(s)).toBe(false);
	});
});

describe('isFailedJob', () => {
	it('is true only for failed and abnormal', () => {
		expect(isFailedJob('failed')).toBe(true);
		expect(isFailedJob('abnormal')).toBe(true);
	});

	it('is false for aborted, completed, and live states (aborted is terminal but not a failure)', () => {
		expect(isFailedJob('aborted')).toBe(false);
		expect(isFailedJob('completed')).toBe(false);
		expect(isFailedJob('running')).toBe(false);
		expect(isFailedJob('queued')).toBe(false);
	});
});

describe('doc2loraScopeCovers', () => {
	it('returns false when nothing is installed (null / undefined)', () => {
		expect(doc2loraScopeCovers(null, 'core')).toBe(false);
		expect(doc2loraScopeCovers(undefined, 'docs')).toBe(false);
	});

	it('a scope covers itself and every lower scope (all >= docs >= core)', () => {
		expect(doc2loraScopeCovers('all', 'all')).toBe(true);
		expect(doc2loraScopeCovers('all', 'docs')).toBe(true);
		expect(doc2loraScopeCovers('all', 'core')).toBe(true);
		expect(doc2loraScopeCovers('docs', 'docs')).toBe(true);
		expect(doc2loraScopeCovers('docs', 'core')).toBe(true);
		expect(doc2loraScopeCovers('core', 'core')).toBe(true);
	});

	it('a lower installed scope does not cover a higher needed scope', () => {
		expect(doc2loraScopeCovers('core', 'docs')).toBe(false);
		expect(doc2loraScopeCovers('core', 'all')).toBe(false);
		expect(doc2loraScopeCovers('docs', 'all')).toBe(false);
	});
});

describe('estimateTrainingSeconds branches not covered by the flat suite', () => {
	it('inflates cold-install overhead when the machine is not prepared', () => {
		const base = { corpusBytes: 1 * MB, baseModel: 'llama-7b', gpu: 'cuda' as const };
		const prepared = estimateTrainingSeconds({ ...base, toolingReady: true });
		const cold = estimateTrainingSeconds({ ...base, toolingReady: false });
		// cold adds the 300s ML-stack download to the fixed overhead
		expect(cold - prepared).toBe(300);
	});

	it('defaults toolingReady to false (cold install) when omitted', () => {
		const base = { corpusBytes: 1 * MB, baseModel: 'llama-7b', gpu: 'cuda' as const };
		expect(estimateTrainingSeconds(base)).toBe(
			estimateTrainingSeconds({ ...base, toolingReady: false })
		);
	});

	it('a 2b model uses the small size multiplier (cheapest of the tiers)', () => {
		const base = { corpusBytes: 5 * MB, gpu: 'cuda' as const, toolingReady: true };
		const twoB = estimateTrainingSeconds({ ...base, baseModel: 'google/gemma-2b-it' });
		const sevenB = estimateTrainingSeconds({ ...base, baseModel: 'llama-7b' });
		const thirtyTwoB = estimateTrainingSeconds({ ...base, baseModel: 'qwen2.5-32b' });
		expect(twoB).toBeLessThan(sevenB);
		expect(sevenB).toBeLessThan(thirtyTwoB);
	});

	it('clamps a tiny corpus to a 0.05 MB floor (never returns just the overhead for 0 bytes)', () => {
		// 0 bytes still costs a little training time above the 120s prepared overhead
		const zero = estimateTrainingSeconds({
			corpusBytes: 0,
			baseModel: 'llama-7b',
			gpu: 'cuda',
			toolingReady: true
		});
		expect(zero).toBeGreaterThan(120);
	});
});

describe('estimatedCorpusBytes', () => {
	it('sums plain-file sizes verbatim', () => {
		const files = [
			{ name: 'a.txt', size: 100 },
			{ name: 'b.md', size: 250 }
		];
		expect(estimatedCorpusBytes(files)).toBe(350);
	});

	it('inflates archive files by ARCHIVE_INFLATION (compressed uploads extract larger)', () => {
		expect(estimatedCorpusBytes([{ name: 'docs.zip', size: 100 }])).toBe(100 * ARCHIVE_INFLATION);
		expect(estimatedCorpusBytes([{ name: 'x.tar.gz', size: 10 }])).toBe(10 * ARCHIVE_INFLATION);
	});

	it('mixes inflated archives with verbatim plain files', () => {
		const files = [
			{ name: 'notes.txt', size: 50 },
			{ name: 'bundle.tgz', size: 100 }
		];
		expect(estimatedCorpusBytes(files)).toBe(50 + 100 * ARCHIVE_INFLATION);
	});

	it('is 0 for an empty file list', () => {
		expect(estimatedCorpusBytes([])).toBe(0);
	});
});

describe('formatBytes', () => {
	it('renders 0 (and falsy) as "0 B"', () => {
		expect(formatBytes(0)).toBe('0 B');
	});

	it('renders bytes with no decimal', () => {
		expect(formatBytes(512)).toBe('512 B');
	});

	it('renders KB / MB / GB / TB / PB with one decimal', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
		expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
		expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
		expect(formatBytes(1024 ** 5)).toBe('1.0 PB');
	});

	it('caps the unit at PB for absurdly large inputs', () => {
		expect(formatBytes(1024 ** 6)).toContain('PB');
	});
});

describe('formatDate', () => {
	it('renders a long month/day/year for a Date', () => {
		expect(formatDate(new Date('2026-06-30T12:00:00Z'))).toMatch(/June \d{1,2}, 2026/);
	});

	it('accepts an ISO string too', () => {
		expect(formatDate('2026-01-15T00:00:00Z')).toMatch(/January \d{1,2}, 2026/);
	});
});

describe('formatDateTime', () => {
	it('renders a short month/day + time', () => {
		const out = formatDateTime('2026-06-30T18:11:00Z');
		expect(out).toMatch(/Jun/);
		expect(out).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
	});

	it('accepts a Date object', () => {
		expect(typeof formatDateTime(new Date('2026-06-30T18:11:00Z'))).toBe('string');
	});
});

// the flat progress.test.ts covers the happy paths; these hit the null/guard/empty branches it omits

describe('parseTrainingProgress clock + malformed brackets', () => {
	it('yields a null remaining for a malformed (non-numeric) time bracket', () => {
		// "aa:bb" is not finite -> clockToSeconds returns null (guard branch)
		const p = parseTrainingProgress(' 50%|## | 5/10 [00:05<aa:bb,  1.00it/s]');
		expect(p.tqdmRemainingSeconds).toBeNull();
	});
});

describe('parseScanEstimateSeconds guards', () => {
	it('returns null for a zero / non-positive estimate', () => {
		expect(parseScanEstimateSeconds('Estimated training time: 0 seconds')).toBeNull();
	});
});

describe('parseTrainingSeries + parsePhaseTimings empty-log guards', () => {
	it('parseTrainingSeries returns the empty series for a null log', () => {
		const s = parseTrainingSeries(null);
		expect(s.points).toHaveLength(0);
		expect(s.summary).toBeNull();
	});

	it('parsePhaseTimings returns [] for a null log', () => {
		expect(parsePhaseTimings(null)).toEqual([]);
	});
});

describe('trainingEtaSeconds step-extrapolation + fallback branches', () => {
	it('extrapolates from step/total when there is no percent (per-step * remaining)', () => {
		const now = 1_000_000;
		// 50 of 100 steps in 100s -> 2s/step * 50 remaining = 100s (percent is null so it uses step path)
		const eta = trainingEtaSeconds({
			progress: snap({ step: 50, totalSteps: 100 }),
			startedAtMs: now - 100_000,
			nowMs: now
		});
		expect(eta).toBe(100);
	});

	it('returns the bare fallback when nothing has started yet (startedAtMs null)', () => {
		const eta = trainingEtaSeconds({
			progress: snap(),
			startedAtMs: null,
			nowMs: 1_000_000,
			fallbackEtaSeconds: 250
		});
		expect(eta).toBe(250);
	});
});

describe('exported constants', () => {
	it('AT_CAPACITY_VRAM_PCT is the 80% capacity threshold', () => {
		expect(AT_CAPACITY_VRAM_PCT).toBe(80);
	});
});
