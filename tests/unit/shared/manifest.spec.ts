import { describe, expect, it } from 'vitest';
import { mapBaseModelToCf, parseManifest, validateManifest } from '../../../src/shared/manifest';

describe('mapBaseModelToCf', () => {
	it('returns null for empty input', () => {
		expect(mapBaseModelToCf('')).toBeNull();
	});

	it('passes through an already-cf -lora id', () => {
		expect(mapBaseModelToCf('@cf/google/gemma-2b-it-lora')).toBe('@cf/google/gemma-2b-it-lora');
	});

	it('maps a known hf name (case-insensitive)', () => {
		expect(mapBaseModelToCf('Google/Gemma-2b-it')).toBe('@cf/google/gemma-2b-it-lora');
	});

	it('matches on the model tail when the full name differs', () => {
		expect(mapBaseModelToCf('some-org/mistral-7b-instruct-v0.2-finetune')).toBe(
			'@cf/mistral/mistral-7b-instruct-v0.2-lora'
		);
	});

	it('returns null for an unknown base', () => {
		expect(mapBaseModelToCf('acme/unknown-model')).toBeNull();
	});
});

describe('parseManifest', () => {
	it('parses a doc2lora adapter.json (nested lora_config)', () => {
		const p = parseManifest({
			base_model: 'google/gemma-2b-it',
			model_type: 'gemma',
			lora_config: { r: 8, alpha: 16, dropout: 0.1, target_modules: ['q_proj', 'v_proj'] },
			max_length: 512
		});
		expect(p.source).toBe('doc2lora');
		expect(p.cfBaseModel).toBe('@cf/google/gemma-2b-it-lora');
		expect(p.modelType).toBe('gemma');
		expect(p.rank).toBe(8);
		expect(p.alpha).toBe(16);
		expect(p.dropout).toBe(0.1);
		expect(p.targetModules).toEqual(['q_proj', 'v_proj']);
		expect(p.maxLength).toBe(512);
	});

	it('parses a peft adapter_config.json and flags advanced variants + quantization', () => {
		const p = parseManifest({
			peft_type: 'LORA',
			base_model_name_or_path: 'mistralai/Mistral-7B-Instruct-v0.2',
			r: 64,
			lora_alpha: 128,
			target_modules: ['q_proj'],
			use_dora: true,
			use_rslora: true,
			loftq_config: { bits: 4 }
		});
		expect(p.source).toBe('peft');
		expect(p.peftType).toBe('LORA');
		expect(p.rank).toBe(64);
		expect(p.quantized).toBe(true);
		expect(p.advanced).toEqual(expect.arrayContaining(['DoRA', 'rsLoRA']));
	});

	it('defaults to unknown source and null fields for an empty/undefined manifest', () => {
		const p = parseManifest(undefined);
		expect(p.source).toBe('unknown');
		expect(p.baseModelRaw).toBe('');
		expect(p.cfBaseModel).toBeNull();
		expect(p.rank).toBeNull();
		expect(p.targetModules).toEqual([]);
	});
});

describe('validateManifest', () => {
	it('passes a clean, in-range LoRA', () => {
		const v = validateManifest(parseManifest({ base_model: 'google/gemma-2b-it', r: 8 }));
		expect(v.ok).toBe(true);
		expect(v.checks.find((c) => c.label === 'Base model')?.status).toBe('pass');
	});

	it('fails a non-LoRA peft_type, over-max rank, and quantization', () => {
		const v = validateManifest(
			parseManifest({
				peft_type: 'IA3',
				base_model_name_or_path: 'google/gemma-2b-it',
				r: 999,
				use_qalora: true
			})
		);
		expect(v.ok).toBe(false);
		const byLabel = Object.fromEntries(v.checks.map((c) => [c.label, c.status]));
		expect(byLabel['Adapter type']).toBe('fail');
		expect(byLabel['Rank']).toBe('fail');
		expect(byLabel['Quantization']).toBe('fail');
	});

	it('warns when base model, rank, model type, and target modules are missing', () => {
		const v = validateManifest(parseManifest({}));
		const byLabel = Object.fromEntries(v.checks.map((c) => [c.label, c.status]));
		expect(byLabel['Base model']).toBe('warn');
		expect(byLabel['Rank']).toBe('warn');
		expect(byLabel['Model type']).toBe('warn');
		expect(byLabel['Target modules']).toBe('warn');
	});

	it('fails a base model with no cloudflare mapping', () => {
		const v = validateManifest(parseManifest({ base_model: 'acme/unknown', r: 8 }));
		expect(v.checks.find((c) => c.label === 'Base model')?.status).toBe('fail');
	});
});
