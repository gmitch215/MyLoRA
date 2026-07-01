import { describe, expect, it } from 'vitest';
import {
	collapseCarriageReturns,
	parsePhaseTimings,
	parseScanEstimateSeconds,
	parseTrainingProgress,
	parseTrainingSeries,
	progressPercent,
	trainingEtaSeconds,
	trainingPhase,
	type TrainingProgress
} from '../../src/shared/types';

describe('parseTrainingProgress', () => {
	it('parses a tqdm bar into percent/step/total/remaining/rate', () => {
		const p = parseTrainingProgress(' 45%|####5     | 450/1000 [00:30<00:37,  12.00it/s]');
		expect(p.percent).toBe(45);
		expect(p.step).toBe(450);
		expect(p.totalSteps).toBe(1000);
		expect(p.tqdmRemainingSeconds).toBe(37);
		expect(p.rate).toContain('it/s');
	});

	it('takes the LAST bar when several appear in the log', () => {
		const log =
			'10%|#         | 100/1000 [00:10<01:00,  1.00it/s]\n' +
			'90%|######### | 900/1000 [00:54<00:06,  1.00it/s]\n';
		const p = parseTrainingProgress(log);
		expect(p.percent).toBe(90);
		expect(p.step).toBe(900);
	});

	it('yields null remaining when tqdm prints "?"', () => {
		const p = parseTrainingProgress('  0%|          | 0/1000 [00:01<?, ?it/s]');
		expect(p.tqdmRemainingSeconds).toBeNull();
	});

	it('reads epoch from a HF Trainer dict log line', () => {
		const p = parseTrainingProgress(`{'loss': 1.2, 'epoch': 1.5}`);
		expect(p.epoch).toBe(1.5);
	});

	it('parses an HH:MM:SS remaining bracket into seconds', () => {
		const p = parseTrainingProgress('  5%|#         | 50/1000 [01:00<1:02:03,  1.00it/s]');
		expect(p.tqdmRemainingSeconds).toBe(3723);
	});

	it('returns an all-null snapshot for an empty log', () => {
		const p = parseTrainingProgress('');
		expect(p).toEqual({
			percent: null,
			step: null,
			totalSteps: null,
			epoch: null,
			tqdmRemainingSeconds: null,
			rate: null
		});
	});
});

describe('progressPercent', () => {
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

	it('prefers the tqdm percent when present', () => {
		expect(progressPercent(snap({ percent: 42, step: 1, totalSteps: 100 }))).toBe(42);
	});

	it('falls back to step/total when no percent', () => {
		expect(progressPercent(snap({ step: 250, totalSteps: 1000 }))).toBe(25);
	});

	it('falls back to epoch/totalEpochs last', () => {
		expect(progressPercent(snap({ epoch: 1 }), 4)).toBe(25);
	});

	it('returns null with nothing to go on', () => {
		expect(progressPercent(snap())).toBeNull();
	});
});

describe('trainingEtaSeconds', () => {
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

	it('tqdm remaining wins when present', () => {
		const eta = trainingEtaSeconds({
			progress: snap({ tqdmRemainingSeconds: 90, percent: 50 }),
			startedAtMs: 0,
			nowMs: 100_000
		});
		expect(eta).toBe(90);
	});

	it('extrapolates from elapsed + percent when no tqdm time (50% after 100s -> ~100s left)', () => {
		const now = 1_000_000;
		const eta = trainingEtaSeconds({
			progress: snap({ percent: 50 }),
			startedAtMs: now - 100_000,
			nowMs: now
		});
		expect(eta).toBe(100);
	});

	it('uses the fallback estimate minus elapsed (clamped to >= 0)', () => {
		const now = 1_000_000;
		const eta = trainingEtaSeconds({
			progress: snap(),
			startedAtMs: now - 30_000,
			nowMs: now,
			fallbackEtaSeconds: 200
		});
		expect(eta).toBe(170);

		const clamped = trainingEtaSeconds({
			progress: snap(),
			startedAtMs: now - 500_000,
			nowMs: now,
			fallbackEtaSeconds: 200
		});
		expect(clamped).toBe(0);
	});

	it('returns null when nothing is known', () => {
		const eta = trainingEtaSeconds({ progress: snap(), startedAtMs: null, nowMs: 1_000_000 });
		expect(eta).toBeNull();
	});
});

describe('collapseCarriageReturns', () => {
	it('returns "" for empty, null, or undefined input', () => {
		expect(collapseCarriageReturns('')).toBe('');
		expect(collapseCarriageReturns(null)).toBe('');
		expect(collapseCarriageReturns(undefined)).toBe('');
	});

	it('returns a plain multi-line string unchanged when there is no carriage return', () => {
		const log = 'line1\nline2\nline3';
		expect(collapseCarriageReturns(log)).toBe(log);
	});

	it('collapses many tqdm frames on one line to the last frame', () => {
		expect(collapseCarriageReturns('\rLoading: 1%\rLoading: 50%\rLoading: 100%')).toBe(
			'Loading: 100%'
		);
	});

	it('applies carriage returns per newline-delimited line', () => {
		expect(collapseCarriageReturns('a\rb\nc\rd')).toBe('b\nd');
	});

	it('treats \\r\\n (windows) as a newline, not an overwrite', () => {
		expect(collapseCarriageReturns('line1\r\nline2')).toBe('line1\nline2');
	});

	it('collapses a realistic mixed training log to its final frames', () => {
		const log = '[venv] starting\n  0%|   | 0/10\r 50%|## | 5/10\r100%|###| 10/10\n[train] done';
		expect(collapseCarriageReturns(log)).toBe('[venv] starting\n100%|###| 10/10\n[train] done');
	});
});

describe('parseTrainingProgress ignores setup/download bars', () => {
	it('does not read a "Fetching N files" download bar as training progress', () => {
		const log = 'Fetching 2 files:   0%|          | 0/2 [00:00<?, ?it/s]';
		const p = parseTrainingProgress(log);
		expect(p.step).toBeNull();
		expect(p.totalSteps).toBeNull();
	});

	it('ignores the download bar but still catches the real training bar after it', () => {
		const log =
			'Fetching 2 files: 100%|##########| 2/2 [00:30<00:00, 15.0s/it]\n' +
			' 40%|####      | 40/100 [00:20<00:30,  2.00it/s]';
		const p = parseTrainingProgress(log);
		expect(p.step).toBe(40);
		expect(p.totalSteps).toBe(100);
	});

	it('skips "Loading checkpoint shards" and dataset "Map" bars', () => {
		expect(
			parseTrainingProgress('Loading checkpoint shards: 50%|## | 1/2 [00:01<00:01]').step
		).toBeNull();
		expect(parseTrainingProgress('Map:  50%|##   | 5/10 [00:00<00:00, 1it/s]').step).toBeNull();
	});
});

describe('trainingPhase', () => {
	it('is null for no log', () => {
		expect(trainingPhase('')).toBeNull();
	});

	it('is "preparing" while only venv/install lines exist', () => {
		expect(trainingPhase('[venv] preparing isolated environment\nInstalled 98 packages')).toBe(
			'preparing'
		);
	});

	it('is "loading" once the train cmd launched but the model is still downloading', () => {
		const log =
			'[train] starting doc2lora\nLoading model: google/gemma-2b-it\nFetching 2 files:   0%|  | 0/2 [00:00<?, ?it/s]';
		expect(trainingPhase(log)).toBe('loading');
	});

	it('is "training" once a loss log or a real step bar appears', () => {
		expect(trainingPhase(`[train] starting\n{'loss': 2.1, 'epoch': 0.5}`)).toBe('training');
		expect(trainingPhase('[train] starting\n 10%|# | 5/50 [00:03<00:27, 1.5it/s]')).toBe(
			'training'
		);
	});
});

describe('parseTrainingSeries', () => {
	it('extracts loss/grad-norm/lr/epoch from unquoted HF Trainer dict logs', () => {
		const log =
			`{'loss': 2.5, 'grad_norm': 1.2, 'learning_rate': 0.0005, 'epoch': 0.2}\n` +
			`some other line\n` +
			`{'loss': 1.8, 'grad_norm': 0.9, 'learning_rate': 0.0004, 'epoch': 0.6}\n` +
			`{'loss': 1.1, 'grad_norm': 0.7, 'learning_rate': 0.0002, 'epoch': 1.0}`;
		const s = parseTrainingSeries(log);
		expect(s.points).toHaveLength(3);
		expect(s.points[0]).toMatchObject({
			step: 1,
			loss: 2.5,
			gradNorm: 1.2,
			lr: 0.0005,
			epoch: 0.2
		});
		expect(s.finalLoss).toBe(1.1);
		expect(s.finalGradNorm).toBe(0.7);
		expect(s.finalLr).toBe(0.0002);
		expect(s.finalEpoch).toBe(1.0);
	});

	it("parses QUOTED doc2lora values (e.g. {'loss': '3.062', ...})", () => {
		const log =
			`{'loss': '3.062', 'grad_norm': '1.051', 'learning_rate': '0.0004', 'epoch': '0.9091'}\n` +
			`{'loss': '2.022', 'grad_norm': '0.966', 'learning_rate': '0.0002333', 'epoch': '1.818'}\n` +
			`{'loss': '1.751', 'grad_norm': '0.7861', 'learning_rate': '6.667e-05', 'epoch': '2.727'}\n` +
			`{'train_runtime': '21.96', 'train_loss': '2.237', 'epoch': '3'}`;
		const s = parseTrainingSeries(log);
		// the 3 real loss logs are captured; the train_runtime summary (train_loss) is NOT a point
		expect(s.points).toHaveLength(3);
		expect(s.points[0]).toMatchObject({ loss: 3.062, gradNorm: 1.051, lr: 0.0004, epoch: 0.9091 });
		expect(s.finalLr).toBeCloseTo(6.667e-5, 9);
		expect(s.finalLoss).toBe(1.751);
		// the final summary dict is parsed for runtime + throughput + mean loss
		expect(s.summary).toMatchObject({ trainRuntime: 21.96, trainLoss: 2.237, epoch: 3 });
	});

	it('parses the train_runtime summary throughput fields', () => {
		const log =
			`{'loss': '1.1', 'epoch': '1.0'}\n` +
			`{'train_runtime': '21.96', 'train_samples_per_second': '6.284', 'train_steps_per_second': '1.503', 'train_loss': '2.237', 'epoch': '3'}`;
		const s = parseTrainingSeries(log);
		expect(s.summary?.samplesPerSecond).toBe(6.284);
		expect(s.summary?.stepsPerSecond).toBe(1.503);
	});

	it('is empty for a log with no loss logs', () => {
		const s = parseTrainingSeries('[venv] installing\n[train] starting');
		expect(s.points).toHaveLength(0);
		expect(s.finalLoss).toBeNull();
		expect(s.finalGradNorm).toBeNull();
		expect(s.summary).toBeNull();
	});

	it('prefers no data over wrong data on malformed dict values', () => {
		// a non-numeric loss does not match the dict shape -> no point (never a NaN/garbage point)
		const s = parseTrainingSeries(`{'loss': 'NaN-ish', 'epoch': 'bogus'}`);
		expect(s.points).toHaveLength(0);
		// a malformed numeric still yields a null field, never an incorrect value
		const s2 = parseTrainingSeries(`{'loss': '1.2.3.4', 'grad_norm': '0.5'}`);
		for (const p of s2.points) {
			expect(p.loss === null || Number.isFinite(p.loss)).toBe(true);
		}
	});
});

describe('parsePhaseTimings', () => {
	it('computes Install / Scan / Training durations from the timestamped markers', () => {
		const log =
			'[20:41:58] [venv] preparing isolated environment\n' +
			'[20:42:10] [scan] doc2lora per-file breakdown\n' +
			'[20:42:20] [train] starting doc2lora\n' +
			'2026-06-30 20:47:20,000 - doc2lora.core - INFO - done';
		const t = parsePhaseTimings(log);
		const by = Object.fromEntries(t.map((x) => [x.label, x.seconds]));
		expect(by.Install).toBe(12);
		expect(by.Scan).toBe(10);
		expect(by.Training).toBe(300);
	});

	it('handles a midnight-utc wrap monotonically', () => {
		const log = '[23:59:50] [venv] x\n[00:00:30] [train] starting\n[00:01:30] done';
		const by = Object.fromEntries(parsePhaseTimings(log).map((x) => [x.label, x.seconds]));
		expect(by.Install).toBe(40);
		expect(by.Training).toBe(60);
	});

	it('is empty for a log without timestamps', () => {
		expect(parsePhaseTimings('no timestamps here')).toEqual([]);
	});
});

describe('parseScanEstimateSeconds', () => {
	it('parses doc2lora scan minute/second/hour estimates to seconds', () => {
		expect(parseScanEstimateSeconds('Estimated training time (~small model): 5 minutes')).toBe(300);
		expect(parseScanEstimateSeconds('Estimated training time: 30 seconds')).toBe(30);
		expect(parseScanEstimateSeconds('Estimated training time (~small model): 1 hour')).toBe(3600);
		expect(parseScanEstimateSeconds('Estimated training time: ~2 minutes')).toBe(120);
	});

	it('returns null when no scan estimate is present', () => {
		expect(parseScanEstimateSeconds('[venv] installing\n[train] starting')).toBeNull();
		expect(parseScanEstimateSeconds('')).toBeNull();
	});

	it('drops an implausible (>24h) duration rather than reporting a bogus phase', () => {
		// venv at 00:00:00 then training end at 23:00:00 next day-ish -> a >24h artifact must be dropped
		const log = '[00:00:00] [venv] x\n[12:00:00] [train] starting\n[23:00:00] done';
		const by = Object.fromEntries(parsePhaseTimings(log).map((x) => [x.label, x.seconds]));
		// Install (00:00 -> 12:00 = 12h) and Training (12:00 -> 23:00 = 11h) are plausible and kept
		expect(by.Install).toBe(43200);
		expect(by.Training).toBe(39600);
		// none exceed the 24h plausibility cap
		for (const t of parsePhaseTimings(log)) expect(t.seconds).toBeLessThanOrEqual(86400);
	});
});
