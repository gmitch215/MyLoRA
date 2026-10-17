import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLING } from '../../../src/shared/defaults';
import {
	adapterSchema,
	assertAlternatingRoles,
	cloudflareAccountSchema,
	contextWindowFor,
	DEFAULT_CONTEXT_WINDOW,
	estimateTokens,
	firstZodIssueMessage,
	hfModelFor,
	machineCreateSchema,
	machineToolingSchema,
	machineUpdateSchema,
	ngrokTokenSchema,
	ngrokTokenUpdateSchema,
	serveStartSchema,
	settingsSchema,
	toolingSettingsSchema,
	trainingConfigSchema,
	trainingJobCreateSchema,
	userCreateSchema,
	userUpdateSchema
} from '../../../src/shared/schemas';

// detectModelType is covered by tests/unit/detect-model-type.test.ts; not duplicated here

describe('hfModelFor', () => {
	it('maps a curated cloudflare base to its huggingface repo id', () => {
		expect(hfModelFor('@cf/mistral/mistral-7b-instruct-v0.2-lora')).toBe(
			'mistralai/Mistral-7B-Instruct-v0.2'
		);
		expect(hfModelFor('@cf/qwen/qwq-32b')).toBe('Qwen/QwQ-32B');
	});

	it('passes a free-typed HF repo id through unchanged', () => {
		expect(hfModelFor('microsoft/phi-2')).toBe('microsoft/phi-2');
		expect(hfModelFor('')).toBe('');
	});
});

describe('contextWindowFor', () => {
	it('returns the known window for a curated base', () => {
		expect(contextWindowFor('@cf/mistral/mistral-7b-instruct-v0.2-lora')).toBe(32768);
		expect(contextWindowFor('@cf/meta/llama-guard-3-8b')).toBe(131072);
	});

	it('falls back to the default window for an unknown base', () => {
		expect(contextWindowFor('some/unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW);
		expect(contextWindowFor('')).toBe(DEFAULT_CONTEXT_WINDOW);
	});
});

describe('estimateTokens', () => {
	it('estimates ~4 chars per token, rounding up', () => {
		expect(estimateTokens('12345678')).toBe(2);
		expect(estimateTokens('123')).toBe(1);
		expect(estimateTokens('12345')).toBe(2);
	});

	it('is 0 for empty / nullish text', () => {
		expect(estimateTokens('')).toBe(0);
		expect(estimateTokens(undefined as unknown as string)).toBe(0);
		expect(estimateTokens(null as unknown as string)).toBe(0);
	});
});

describe('firstZodIssueMessage', () => {
	it('returns the fallback for no issues', () => {
		expect(firstZodIssueMessage([], 'boom')).toBe('boom');
		expect(firstZodIssueMessage(undefined, 'boom')).toBe('boom');
	});

	it('prefixes a known field label onto the issue message', () => {
		const msg = firstZodIssueMessage([{ path: ['username'], message: 'Too short' }], 'fallback');
		expect(msg).toBe('Username: Too short');
	});

	it('uses the raw path key when it has no mapped label', () => {
		const msg = firstZodIssueMessage([{ path: ['weird'], message: 'nope' }], 'fallback');
		expect(msg).toBe('weird: nope');
	});

	it('falls back on the "Invalid input" placeholder message', () => {
		const msg = firstZodIssueMessage(
			[{ path: ['rank'], message: 'Invalid input' }],
			'better message'
		);
		expect(msg).toBe('Rank: better message');
	});

	it('falls back when the message is missing entirely', () => {
		expect(firstZodIssueMessage([{ path: ['name'] }], 'fb')).toBe('Name: fb');
	});

	it('returns the bare message when the path is empty (no label)', () => {
		expect(firstZodIssueMessage([{ path: [], message: 'top-level error' }], 'fb')).toBe(
			'top-level error'
		);
	});
});

describe('adapterSchema', () => {
	const valid = {
		name: 'My Adapter',
		slug: 'my-adapter',
		baseModel: '@cf/google/gemma-2b-it-lora',
		modelType: 'gemma' as const,
		rank: 8
	};

	it('parses a minimal valid adapter and applies array + visibility defaults', () => {
		const r = adapterSchema.parse(valid);
		expect(r.tags).toEqual([]);
		expect(r.examples).toEqual([]);
		expect(r.visibility).toBe('public');
	});

	it('rejects a bad slug (uppercase / spaces)', () => {
		const r = adapterSchema.safeParse({ ...valid, slug: 'Bad Slug' });
		expect(r.success).toBe(false);
		expect(r.error!.issues[0]!.message).toMatch(/lowercase letters/);
	});

	it('rejects a rank above the CF ceiling', () => {
		const r = adapterSchema.safeParse({ ...valid, rank: 64 });
		expect(r.success).toBe(false);
	});

	it('rejects a non-integer rank', () => {
		const r = adapterSchema.safeParse({ ...valid, rank: 1.5 });
		expect(r.success).toBe(false);
	});

	it('rejects an empty name', () => {
		const r = adapterSchema.safeParse({ ...valid, name: '' });
		expect(r.success).toBe(false);
	});

	it('accepts an empty-string description via the .or(literal("")) escape hatch', () => {
		expect(adapterSchema.safeParse({ ...valid, description: '' }).success).toBe(true);
	});

	it('rejects an example with an empty input', () => {
		const r = adapterSchema.safeParse({ ...valid, examples: [{ input: '' }] });
		expect(r.success).toBe(false);
	});
});

describe('cloudflareAccountSchema', () => {
	const valid = {
		label: 'Prod',
		accountId: 'a'.repeat(32),
		apiToken: 'x'.repeat(40)
	};

	it('parses a valid account and defaults scope/shared/isDefault', () => {
		const r = cloudflareAccountSchema.parse(valid);
		expect(r.tokenScope).toBe('readwrite');
		expect(r.shared).toBe(false);
		expect(r.isDefault).toBe(false);
	});

	it('rejects a non-32-hex account id', () => {
		expect(cloudflareAccountSchema.safeParse({ ...valid, accountId: 'nope' }).success).toBe(false);
		expect(cloudflareAccountSchema.safeParse({ ...valid, accountId: 'g'.repeat(32) }).success).toBe(
			false
		);
	});

	it('rejects a too-short api token', () => {
		expect(cloudflareAccountSchema.safeParse({ ...valid, apiToken: 'short' }).success).toBe(false);
	});
});

describe('userCreateSchema', () => {
	const valid = {
		username: 'gregory',
		displayName: 'Gregory',
		password: 'password1',
		role: 'developer' as const
	};

	it('parses a valid user and runs the lowercase transform', () => {
		// the regex forbids uppercase, so it fails BEFORE the transform; the transform only normalizes
		// already-valid (lowercase) input
		const r = userCreateSchema.parse(valid);
		expect(r.username).toBe('gregory');
		expect(userCreateSchema.safeParse({ ...valid, username: 'GregORY' }).success).toBe(false);
	});

	it('rejects a too-short username (regex requires 3-32 chars)', () => {
		expect(userCreateSchema.safeParse({ ...valid, username: 'ab' }).success).toBe(false);
	});

	it('rejects a password under 8 chars', () => {
		expect(userCreateSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
	});

	it('rejects an unknown role', () => {
		expect(
			userCreateSchema.safeParse({ ...valid, role: 'wizard' as unknown as 'developer' }).success
		).toBe(false);
	});
});

describe('userUpdateSchema', () => {
	it('runs the optional username lowercase transform when present', () => {
		const r = userUpdateSchema.parse({ username: 'gregory', displayName: 'G' });
		expect(r.username).toBe('gregory');
	});

	it('parses an empty patch (all fields optional)', () => {
		expect(userUpdateSchema.safeParse({}).success).toBe(true);
	});
});

describe('machineCreateSchema refinements', () => {
	const base = {
		label: 'Box',
		host: 'gpu.example.com',
		username: 'ubuntu'
	};

	it('parses a key-auth machine with a generated key and applies defaults', () => {
		const r = machineCreateSchema.parse(base);
		expect(r.port).toBe(22);
		expect(r.connectionType).toBe('vps');
		expect(r.authMethod).toBe('key');
		expect(r.keySource).toBe('generated');
	});

	it('rejects password auth without a password', () => {
		const r = machineCreateSchema.safeParse({ ...base, authMethod: 'password' });
		expect(r.success).toBe(false);
		expect(r.error!.issues[0]!.path).toEqual(['password']);
	});

	it('accepts password auth with a password', () => {
		expect(
			machineCreateSchema.safeParse({ ...base, authMethod: 'password', password: 'hunter2' })
				.success
		).toBe(true);
	});

	it('rejects key auth with keySource provided but no private key', () => {
		const r = machineCreateSchema.safeParse({ ...base, keySource: 'provided' });
		expect(r.success).toBe(false);
		expect(r.error!.issues[0]!.path).toEqual(['privateKey']);
	});

	it('accepts key auth with a provided private key', () => {
		expect(
			machineCreateSchema.safeParse({
				...base,
				keySource: 'provided',
				privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----'
			}).success
		).toBe(true);
	});

	it('rejects an invalid host', () => {
		expect(machineCreateSchema.safeParse({ ...base, host: 'bad host!' }).success).toBe(false);
	});

	it('rejects an out-of-range port', () => {
		expect(machineCreateSchema.safeParse({ ...base, port: 70000 }).success).toBe(false);
	});
});

describe('trainingConfigSchema defaults', () => {
	it('fills the full default config from just a base model', () => {
		const r = trainingConfigSchema.parse({ baseModel: 'microsoft/phi-2' });
		expect(r.rank).toBe(8);
		expect(r.loraAlpha).toBe(16);
		expect(r.loraDropout).toBe(0.1);
		expect(r.epochs).toBe(3);
		expect(r.learningRate).toBe(0.0005);
		expect(r.maxLength).toBe(512);
		expect(r.batchSize).toBe(4);
		expect(r.gradientAccumulationSteps).toBe(1);
		expect(r.load4bit).toBe(false);
		expect(r.device).toBe('auto');
		expect(r.targetModules).toEqual([]);
		expect(r.hfSplit).toBe('train');
		expect(r.resolution).toBe(512);
		expect(r.abortOnError).toBe(true);
		expect(r.doc2loraExtras).toBe('docs');
		expect(r.useVenv).toBe(true);
		expect(r.pythonVersion).toBe('3.11');
		expect(r.useSudo).toBe(false);
	});

	it('rejects a bad python version', () => {
		expect(trainingConfigSchema.safeParse({ baseModel: 'x', pythonVersion: 'py3' }).success).toBe(
			false
		);
	});

	it('rejects a bad output slug shape', () => {
		expect(trainingConfigSchema.safeParse({ baseModel: 'x', outputSlug: 'Bad Slug' }).success).toBe(
			false
		);
	});

	it('rejects a learning rate above the max', () => {
		expect(trainingConfigSchema.safeParse({ baseModel: 'x', learningRate: 1 }).success).toBe(false);
	});
});

describe('trainingJobCreateSchema refinements', () => {
	const doc2loraJob = {
		machineId: 'm1',
		engine: 'doc2lora' as const,
		datasetId: 'ds1',
		config: { baseModel: '@cf/google/gemma-2b-it-lora' }
	};

	it('parses a valid doc2lora job with a dataset and applies defaults', () => {
		const r = trainingJobCreateSchema.parse(doc2loraJob);
		expect(r.inputKind).toBe('documents');
		expect(r.autoPublish).toBe(false);
		expect(r.autoUploadFinetune).toBe(false);
	});

	it('rejects a doc2lora job with no dataset id', () => {
		const r = trainingJobCreateSchema.safeParse({ ...doc2loraJob, datasetId: '' });
		expect(r.success).toBe(false);
		expect(r.error!.issues[0]!.path).toEqual(['datasetId']);
	});

	it('rejects a peft job without an hf dataset id', () => {
		const r = trainingJobCreateSchema.safeParse({
			machineId: 'm1',
			engine: 'peft',
			config: { baseModel: 'microsoft/phi-2' }
		});
		expect(r.success).toBe(false);
		expect(r.error!.issues[0]!.path).toEqual(['config', 'hfDataset']);
	});

	it('accepts a peft job with an hf dataset id (no upload needed)', () => {
		const r = trainingJobCreateSchema.safeParse({
			machineId: 'm1',
			engine: 'peft',
			config: { baseModel: 'microsoft/phi-2', hfDataset: 'squad' }
		});
		expect(r.success).toBe(true);
	});

	it('rejects an unknown engine', () => {
		expect(
			trainingJobCreateSchema.safeParse({
				...doc2loraJob,
				engine: 'unknown' as unknown as 'peft'
			}).success
		).toBe(false);
	});
});

describe('settingsSchema blank-tolerant branding', () => {
	it('accepts a blank theme color (use-default) and a valid hex, rejects a bad hex', () => {
		expect(settingsSchema.safeParse({ themeColor: '' }).success).toBe(true);
		expect(settingsSchema.safeParse({ themeColor: '#6d28d9' }).success).toBe(true);
		expect(settingsSchema.safeParse({ themeColor: 'purple' }).success).toBe(false);
	});

	it('accepts a null banner and a blank-text banner (both mean no banner)', () => {
		expect(settingsSchema.safeParse({ message: null }).success).toBe(true);
		expect(
			settingsSchema.safeParse({ message: { text: '', type: 'info', icon: '' } }).success
		).toBe(true);
	});

	it('accepts a real banner', () => {
		expect(
			settingsSchema.safeParse({ message: { text: 'Heads up', type: 'warning' } }).success
		).toBe(true);
	});
});

describe('settingsSchema versus limits', () => {
	const base = {
		maxWeightsBytes: 1024,
		maxRank: 8,
		maxScreenshots: 6,
		gridPageSize: 24,
		accountBudgetPerMinute: 300,
		inferenceCacheTtl: 60,
		maxOutputTokens: 512,
		maxSystemPromptChars: 2000,
		logRetentionDays: 90
	};

	it('defaults the versus range when an older client omits it', () => {
		const parsed = settingsSchema.safeParse({ limits: base });
		expect(parsed.success).toBe(true);
		expect(parsed.data!.limits!.versusMinMessages).toBe(1);
		expect(parsed.data!.limits!.versusMaxMessages).toBe(10);
	});

	it('accepts a range inside the hard bounds', () => {
		const parsed = settingsSchema.safeParse({
			limits: { ...base, versusMinMessages: 3, versusMaxMessages: 25 }
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data!.limits!.versusMaxMessages).toBe(25);
	});

	it('rejects a range outside the hard bounds', () => {
		expect(settingsSchema.safeParse({ limits: { ...base, versusMaxMessages: 26 } }).success).toBe(
			false
		);
		expect(settingsSchema.safeParse({ limits: { ...base, versusMinMessages: 0 } }).success).toBe(
			false
		);
	});

	it('rejects a fractional message count', () => {
		expect(settingsSchema.safeParse({ limits: { ...base, versusMinMessages: 2.5 } }).success).toBe(
			false
		);
	});
});

describe('tooling schemas', () => {
	const full = { ...DEFAULT_TOOLING };

	it('accepts the defaults and a settings payload that carries them', () => {
		expect(toolingSettingsSchema.safeParse(full).success).toBe(true);
		expect(settingsSchema.safeParse({ tooling: full }).success).toBe(true);
		expect(settingsSchema.safeParse({}).success).toBe(true);
	});

	it.each([
		['vllmVersion', '0.31.0; rm -rf /'],
		['vllmVersion', 'latest'],
		['vllmVersion', '0.31.0-rc1'],
		['cloudflaredVersion', '2026.10'],
		['cloudflaredVersion', 'v2026.10.0'],
		['pythonVersion', '2.7'],
		['pythonVersion', '3.11; ls'],
		['downloadRetries', 0],
		['downloadRetries', 11],
		['networkWaitMinutes', -1],
		['networkWaitMinutes', 121],
		['bandwidthLimitKbps', -5],
		['bandwidthLimitKbps', 1.5]
	])('rejects %s = %s', (key, value) => {
		expect(toolingSettingsSchema.safeParse({ ...full, [key]: value }).success).toBe(false);
	});

	it.each([
		['vllmVersion', '0.31.0'],
		['vllmVersion', '0.31.0rc1'],
		['vllmVersion', '0.11.0.post1'],
		['vllmVersion', '1.0'],
		['cloudflaredVersion', '2026.9.3'],
		['pythonVersion', '3.12'],
		['pythonVersion', '3.11.9'],
		['bandwidthLimitKbps', 0],
		['networkWaitMinutes', 0]
	])('accepts %s = %s', (key, value) => {
		expect(toolingSettingsSchema.safeParse({ ...full, [key]: value }).success).toBe(true);
	});

	it('lets a machine override carry any subset, including none', () => {
		expect(machineToolingSchema.safeParse({}).success).toBe(true);
		expect(machineToolingSchema.safeParse({ vllmVersion: '0.30.0' }).success).toBe(true);
		expect(machineToolingSchema.safeParse({ autoInstall: false }).success).toBe(true);
		expect(machineToolingSchema.safeParse({ vllmVersion: 'nope' }).success).toBe(false);
	});

	it('takes an override on a machine, and null to clear it on an update', () => {
		const base = { label: 'Box', host: 'gpu.example.com', username: 'ubuntu' };
		expect(
			machineCreateSchema.safeParse({ ...base, tooling: { downloadRetries: 3 } }).success
		).toBe(true);
		expect(machineUpdateSchema.safeParse({ tooling: null }).success).toBe(true);
		expect(machineUpdateSchema.safeParse({ tooling: { downloadRetries: 99 } }).success).toBe(false);
	});
});

describe('ngrok token schemas', () => {
	const token = 'abcdefghij0123456789_KLMNO-pqrst';

	it('requires a label and a plausible token, and defaults the flags off', () => {
		const parsed = ngrokTokenSchema.parse({ label: 'Team', token });
		expect(parsed).toMatchObject({ shared: false, isDefault: false });
		expect(ngrokTokenSchema.safeParse({ label: '', token }).success).toBe(false);
		expect(ngrokTokenSchema.safeParse({ label: 'x', token: 'short' }).success).toBe(false);
	});

	it('rejects characters that could break out of the config file', () => {
		for (const bad of [`${token}\n`, `${token} extra`, `${token}"`, `${token}:`]) {
			expect(ngrokTokenSchema.safeParse({ label: 'x', token: bad }).success).toBe(false);
		}
	});

	it('lets an update leave the token blank to keep the stored one', () => {
		expect(ngrokTokenUpdateSchema.safeParse({ token: '' }).success).toBe(true);
		expect(ngrokTokenUpdateSchema.safeParse({ label: 'New', isDefault: true }).success).toBe(true);
		expect(ngrokTokenUpdateSchema.safeParse({ token: 'short' }).success).toBe(false);
	});

	it('defaults a serve to the automatic token choice', () => {
		const parsed = serveStartSchema.parse({
			label: 'L',
			machineId: 'm',
			baseModel: 'org/model',
			adapterIds: ['a']
		});
		expect(parsed.ngrokToken).toBe('auto');
		expect(parsed.tunnel).toBe('ngrok');
	});
});

describe('assertAlternatingRoles', () => {
	const user = { role: 'user', content: 'q' };
	const assistant = { role: 'assistant', content: 'a' };
	const system = { role: 'system', content: 's' };

	it('accepts a conversation that starts on user and alternates', () => {
		expect(() => assertAlternatingRoles([user])).not.toThrow();
		expect(() => assertAlternatingRoles([user, assistant, user])).not.toThrow();
	});

	it('allows one leading system turn', () => {
		expect(() => assertAlternatingRoles([system, user])).not.toThrow();
		expect(() => assertAlternatingRoles([system, user, assistant, user])).not.toThrow();
	});

	it('rejects a conversation that leads with assistant', () => {
		// the versus regression: alternating, but starting on the wrong role
		expect(() => assertAlternatingRoles([assistant, user])).toThrow(/must alternate/);
		expect(() => assertAlternatingRoles([system, assistant, user])).toThrow(/must alternate/);
	});

	it('rejects two turns of the same role in a row', () => {
		expect(() => assertAlternatingRoles([user, user])).toThrow(/must alternate/);
		expect(() => assertAlternatingRoles([user, assistant, assistant])).toThrow(/must alternate/);
	});

	it('rejects an empty conversation and a system-only one', () => {
		expect(() => assertAlternatingRoles([])).toThrow(/must alternate/);
		expect(() => assertAlternatingRoles([system])).toThrow(/must alternate/);
	});

	it('names the offending sequence in the message', () => {
		expect(() => assertAlternatingRoles([assistant, user])).toThrow(/assistant,user/);
	});
});
