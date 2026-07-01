import { describe, expect, it } from 'vitest';
import {
	buildAccelerateArgs,
	buildRunScript,
	DIFFUSERS_TRAIN_URL,
	hasAdapterConfig,
	outputWeightsName,
	type RemoteTrainingConfig
} from '../../src/server/utils/remote-commands';

// a diffusion text-to-image LoRA config (accelerate engine)
function cfg(over: Partial<RemoteTrainingConfig> = {}): RemoteTrainingConfig {
	return {
		baseModel: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
		rank: 4,
		loraAlpha: 16,
		loraDropout: 0.1,
		epochs: 1,
		learningRate: 0.0001,
		maxLength: 512,
		batchSize: 1,
		gradientAccumulationSteps: 4,
		load4bit: false,
		device: 'cuda',
		targetModules: [],
		hfDataset: 'lambdalabs/naruto-blip-captions',
		captionColumn: 'text',
		resolution: 512,
		...over
	};
}

describe('buildAccelerateArgs', () => {
	it('launches the diffusers script with the expected flags', () => {
		const jobDir = '/tmp/mylora-jobs/ja';
		const args = buildAccelerateArgs(jobDir, cfg());
		// accelerate bin + launch + the diffusers training script path
		expect(args[0]).toBe(`${jobDir}/venv/bin/accelerate`);
		expect(args[1]).toBe('launch');
		expect(args).toContain(`${jobDir}/train_accelerate.py`);

		expect(args[args.indexOf('--pretrained_model_name_or_path') + 1]).toBe(
			'stable-diffusion-v1-5/stable-diffusion-v1-5'
		);
		expect(args[args.indexOf('--dataset_name') + 1]).toBe('lambdalabs/naruto-blip-captions');
		expect(args[args.indexOf('--caption_column') + 1]).toBe('text');
		expect(args[args.indexOf('--resolution') + 1]).toBe('512');
		expect(args[args.indexOf('--rank') + 1]).toBe('4');
		expect(args[args.indexOf('--output_dir') + 1]).toBe(`${jobDir}/out`);
	});

	it('defaults max_train_steps to 1000 when maxSteps is unset', () => {
		const args = buildAccelerateArgs('/tmp/mylora-jobs/ja', cfg({ maxSteps: undefined }));
		expect(args[args.indexOf('--max_train_steps') + 1]).toBe('1000');
	});

	it('passes a provided maxSteps through', () => {
		const args = buildAccelerateArgs('/tmp/mylora-jobs/ja', cfg({ maxSteps: 2500 }));
		expect(args[args.indexOf('--max_train_steps') + 1]).toBe('2500');
	});
});

describe('outputWeightsName', () => {
	it('uses the diffusers weights name for accelerate', () => {
		expect(outputWeightsName('accelerate')).toBe('pytorch_lora_weights.safetensors');
	});

	it('uses adapter_model.safetensors for peft + doc2lora', () => {
		expect(outputWeightsName('peft')).toBe('adapter_model.safetensors');
		expect(outputWeightsName('doc2lora')).toBe('adapter_model.safetensors');
	});
});

describe('hasAdapterConfig', () => {
	it('is false for accelerate (diffusers emits no adapter_config.json) and true otherwise', () => {
		expect(hasAdapterConfig('accelerate')).toBe(false);
		expect(hasAdapterConfig('peft')).toBe(true);
		expect(hasAdapterConfig('doc2lora')).toBe(true);
	});
});

describe('buildRunScript (accelerate engine)', () => {
	it('fetches the diffusers script, runs a default accelerate config, and gates on the diffusers weights', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/ja',
			engine: 'accelerate',
			config: cfg()
		});
		// drives accelerate + writes a default accelerate config
		expect(script).toContain('accelerate');
		expect(script).toContain('config default');
		// pulls the pinned diffusers example script (url or filename) and installs the pinned package
		expect(
			script.includes(DIFFUSERS_TRAIN_URL) || script.includes('train_text_to_image_lora.py')
		).toBe(true);
		expect(script).toContain('diffusers==');
		// the success sentinel checks for the diffusers weights filename under out/
		expect(script).toContain('out/pytorch_lora_weights.safetensors');
	});
});
