import { describe, expect, it } from 'vitest';
import { estimateTrainingSeconds, formatDuration } from '../../src/shared/types';

const MB = 1024 * 1024;

describe('estimateTrainingSeconds', () => {
	it('is monotonic in corpus size', () => {
		const small = estimateTrainingSeconds({
			corpusBytes: 1 * MB,
			baseModel: 'llama-7b',
			gpu: 'cuda'
		});
		const big = estimateTrainingSeconds({
			corpusBytes: 10 * MB,
			baseModel: 'llama-7b',
			gpu: 'cuda'
		});
		expect(big).toBeGreaterThan(small);
	});

	it('is monotonic in epochs', () => {
		const few = estimateTrainingSeconds({
			corpusBytes: 5 * MB,
			baseModel: 'llama-7b',
			gpu: 'cuda',
			epochs: 1
		});
		const many = estimateTrainingSeconds({
			corpusBytes: 5 * MB,
			baseModel: 'llama-7b',
			gpu: 'cuda',
			epochs: 10
		});
		expect(many).toBeGreaterThan(few);
	});

	it('orders devices cuda < mps < cpu', () => {
		const base = { corpusBytes: 5 * MB, baseModel: 'llama-7b' as const } as const;
		const cuda = estimateTrainingSeconds({ ...base, gpu: 'cuda' });
		const mps = estimateTrainingSeconds({ ...base, gpu: 'mps' });
		const cpu = estimateTrainingSeconds({ ...base, gpu: 'cpu' });
		expect(cuda).toBeLessThan(mps);
		expect(mps).toBeLessThan(cpu);
	});

	it('a 32b model takes longer than a 7b model', () => {
		const base = { corpusBytes: 5 * MB, gpu: 'cuda' as const } as const;
		const sevenB = estimateTrainingSeconds({ ...base, baseModel: 'llama-3.1-7b' });
		const thirtyTwoB = estimateTrainingSeconds({ ...base, baseModel: 'qwen2.5-32b' });
		expect(thirtyTwoB).toBeGreaterThan(sevenB);
	});

	it('load4bit on cuda reduces the estimate', () => {
		const base = { corpusBytes: 5 * MB, baseModel: 'llama-7b', gpu: 'cuda' as const } as const;
		const full = estimateTrainingSeconds({ ...base, load4bit: false });
		const quant = estimateTrainingSeconds({ ...base, load4bit: true });
		expect(quant).toBeLessThan(full);
	});

	it('load4bit has no speed effect off cuda (cpu/mps)', () => {
		const base = { corpusBytes: 5 * MB, baseModel: 'llama-7b', gpu: 'cpu' as const } as const;
		const full = estimateTrainingSeconds({ ...base, load4bit: false });
		const quant = estimateTrainingSeconds({ ...base, load4bit: true });
		expect(quant).toBe(full);
	});

	it('always includes the fixed overhead floor', () => {
		const tiny = estimateTrainingSeconds({ corpusBytes: 0, baseModel: 'llama-7b', gpu: 'cuda' });
		expect(tiny).toBeGreaterThanOrEqual(120);
	});
});

describe('formatDuration', () => {
	it('formats sub-minute as seconds', () => {
		expect(formatDuration(45)).toBe('45s');
	});

	it('formats minutes', () => {
		expect(formatDuration(300)).toBe('5 min');
	});

	it('formats hours with remaining minutes', () => {
		expect(formatDuration(2 * 3600 + 30 * 60)).toBe('2h 30m');
	});

	it('drops the minutes when on the hour', () => {
		expect(formatDuration(3 * 3600)).toBe('3h');
	});

	it('formats days with remaining hours', () => {
		expect(formatDuration(24 * 3600)).toBe('1d 0h');
		expect(formatDuration(25 * 3600)).toBe('1d 1h');
	});

	it('clamps negatives to 0s', () => {
		expect(formatDuration(-5)).toBe('0s');
	});
});
