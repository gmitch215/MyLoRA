import { describe, expect, it } from 'vitest';
import {
	tuneConfigForVram,
	vramNeeds,
	type RemoteTrainingConfig
} from '../../src/server/utils/remote-commands';

// a 7B/8B-class baseline; tests override only the fields they care about
function cfg(over: Partial<RemoteTrainingConfig> = {}): RemoteTrainingConfig {
	return {
		baseModel: 'mistralai/Mistral-7B-Instruct-v0.2',
		rank: 8,
		loraAlpha: 16,
		loraDropout: 0.1,
		epochs: 3,
		learningRate: 0.0005,
		maxLength: 512,
		batchSize: 4,
		gradientAccumulationSteps: 1,
		load4bit: false,
		device: 'cuda',
		targetModules: ['q_proj', 'v_proj'],
		...over
	};
}

describe('vramNeeds', () => {
	it('maps a 7B model to 16000 full / 8000 4-bit', () => {
		expect(vramNeeds('mistralai/Mistral-7B-Instruct-v0.2')).toEqual({ full: 16000, fourBit: 8000 });
	});

	it('maps a 32B model to 40000 full / 20000 4-bit', () => {
		expect(vramNeeds('qwen2.5-32b-instruct')).toEqual({ full: 40000, fourBit: 20000 });
	});
});

describe('tuneConfigForVram', () => {
	it('enables 4-bit and drops batch size to fit a 7B model into 12282MB', () => {
		const tune = tuneConfigForVram(cfg({ load4bit: false, batchSize: 4 }), 12282);
		expect(tune.feasible).toBe(true);
		expect(tune.config.load4bit).toBe(true);
		expect(tune.config.batchSize).toBe(1);
		// effective batch preserved: grad-accum multiplied by the original batch size
		expect(tune.config.gradientAccumulationSteps).toBe(4);
		expect(tune.adjustments.length).toBeGreaterThan(0);
	});

	it('makes no changes when full precision already fits', () => {
		const tune = tuneConfigForVram(cfg({ load4bit: false, batchSize: 4 }), 40000);
		expect(tune.feasible).toBe(true);
		expect(tune.adjustments).toEqual([]);
		expect(tune.config.load4bit).toBe(false);
		expect(tune.config.batchSize).toBe(4);
		expect(tune.config.gradientAccumulationSteps).toBe(1);
	});

	it('reports infeasible (with a reason) when even 4-bit cannot fit', () => {
		const tune = tuneConfigForVram(cfg({ load4bit: false, batchSize: 4 }), 4000);
		expect(tune.feasible).toBe(false);
		expect(tune.reason).toBeTruthy();
		expect(typeof tune.reason).toBe('string');
	});

	it('leaves a cpu run untouched regardless of VRAM', () => {
		for (const vram of [0, 4000, 12282, 40000]) {
			const tune = tuneConfigForVram(cfg({ device: 'cpu', load4bit: false, batchSize: 4 }), vram);
			expect(tune.feasible).toBe(true);
			expect(tune.adjustments).toEqual([]);
			expect(tune.config.load4bit).toBe(false);
			expect(tune.config.batchSize).toBe(4);
		}
	});
});
