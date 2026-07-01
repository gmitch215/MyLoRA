import { describe, expect, it } from 'vitest';
import {
	doc2loraPipSpec,
	hasAdapterConfig,
	jobDirFor,
	outputWeightsName
} from '../../../src/server/utils/remote-commands';

// these helpers are not exercised by tests/unit/remote-commands.test.ts; cover them here

describe('outputWeightsName', () => {
	it('accelerate emits diffusers weights', () => {
		expect(outputWeightsName('accelerate')).toBe('pytorch_lora_weights.safetensors');
	});

	it('other engines emit the peft weights name', () => {
		expect(outputWeightsName('peft')).toBe('adapter_model.safetensors');
		expect(outputWeightsName('doc2lora' as any)).toBe('adapter_model.safetensors');
	});
});

describe('hasAdapterConfig', () => {
	it('accelerate has no adapter_config.json', () => {
		expect(hasAdapterConfig('accelerate')).toBe(false);
	});

	it('other engines do', () => {
		expect(hasAdapterConfig('peft')).toBe(true);
		expect(hasAdapterConfig('doc2lora' as any)).toBe(true);
	});
});

describe('jobDirFor', () => {
	it('roots the job dir under /tmp/mylora-jobs', () => {
		expect(jobDirFor('abc123')).toBe('/tmp/mylora-jobs/abc123');
	});
});

describe('doc2loraPipSpec', () => {
	it('encodes the extras scope as the pip extra', () => {
		expect(doc2loraPipSpec('core')).toContain('doc2lora @ ');
		expect(doc2loraPipSpec('core')).not.toContain('[');
		expect(doc2loraPipSpec('docs')).toContain('doc2lora[docs] @ ');
		expect(doc2loraPipSpec('all')).toContain('doc2lora[all] @ ');
	});

	it('defaults to the docs scope', () => {
		expect(doc2loraPipSpec()).toContain('doc2lora[docs] @ ');
	});
});
