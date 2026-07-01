import { describe, expect, it } from 'vitest';
import { detectModelType } from '../../src/shared/schemas';

// detectModelType maps a (possibly free-text HF) base id onto the cloudflare lora family, or null
// when the base is not CF-deployable (so a PEFT adapter on it is download-only)
describe('detectModelType', () => {
	it('maps mistral ids', () => {
		expect(detectModelType('mistralai/Mistral-7B')).toBe('mistral');
		expect(detectModelType('@cf/mistral/mistral-7b-instruct-v0.2-lora')).toBe('mistral');
	});

	it('maps anything llama -> llama', () => {
		expect(detectModelType('meta-llama/Llama-3.1-8B')).toBe('llama');
		expect(detectModelType('some-random-llama-finetune')).toBe('llama');
	});

	it('maps gemma ids', () => {
		expect(detectModelType('google/gemma-2b')).toBe('gemma');
	});

	it('maps both qwen and qwq -> qwen', () => {
		expect(detectModelType('Qwen/Qwen2.5')).toBe('qwen');
		expect(detectModelType('@cf/qwen/qwq-32b')).toBe('qwen');
	});

	it('returns null for non-CF bases (download-only)', () => {
		expect(detectModelType('gpt2')).toBeNull();
		expect(detectModelType('microsoft/phi-2')).toBeNull();
	});

	it('returns null for empty / nullish input', () => {
		expect(detectModelType('')).toBeNull();
		expect(detectModelType(undefined as unknown as string)).toBeNull();
	});
});
