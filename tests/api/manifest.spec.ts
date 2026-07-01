import { loginViaApi } from '../utils/auth';
import { expect, test } from './fixtures';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

// a real doc2lora adapter.json (the debate_ld shape)
const DOC2LORA = {
	adapter_path: 'adapter_adapter',
	base_model: 'mistralai/Mistral-7B-Instruct-v0.2',
	model_type: 'mistral',
	lora_config: { r: 16, alpha: 16, dropout: 0.1, target_modules: ['q_proj', 'k_proj'] },
	max_length: 512,
	cloudflare_compatible: true
};

test.describe('manifest parse + validate', () => {
	test('polyfills and passes a valid doc2lora manifest', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/adapters/parse-manifest', {
			data: { manifest: DOC2LORA }
		});
		expect(res.ok()).toBe(true);
		const { parsed, validation } = await res.json();
		expect(parsed.cfBaseModel).toBe('@cf/mistral/mistral-7b-instruct-v0.2-lora');
		expect(parsed.modelType).toBe('mistral');
		expect(parsed.rank).toBe(16);
		expect(validation.ok).toBe(true);
	});

	test('parses a peft adapter_config.json and flags an over-rank adapter', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/adapters/parse-manifest', {
			data: {
				manifest: {
					peft_type: 'LORA',
					base_model_name_or_path: 'mistralai/Mistral-7B-Instruct-v0.2',
					r: 64,
					lora_alpha: 16,
					model_type: 'mistral',
					target_modules: ['q_proj']
				}
			}
		});
		const { parsed, validation } = await res.json();
		expect(parsed.rank).toBe(64);
		expect(validation.ok).toBe(false);
		expect(validation.checks.some((c: any) => c.label === 'Rank' && c.status === 'fail')).toBe(
			true
		);
	});

	test('fails an unsupported base model', async ({ request }) => {
		await loginViaApi(request);
		const res = await request.post('/api/adapters/parse-manifest', {
			data: { manifest: { base_model: 'some-org/unknown-model-13b', model_type: 'mistral', r: 8 } }
		});
		const { parsed, validation } = await res.json();
		expect(parsed.cfBaseModel).toBeNull();
		expect(
			validation.checks.some((c: any) => c.label === 'Base model' && c.status === 'fail')
		).toBe(true);
	});

	test('requires authentication', async ({ playwright }) => {
		const anon = await playwright.request.newContext({ baseURL: BASE });
		const res = await anon.post('/api/adapters/parse-manifest', {
			data: { manifest: DOC2LORA }
		});
		expect(res.status()).toBeGreaterThanOrEqual(400);
		await anon.dispose();
	});
});
