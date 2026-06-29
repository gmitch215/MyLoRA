import { CF_MAX_RANK, DEFAULT_BASE_MODELS, MODEL_TYPES } from './schemas';
import type { ModelType } from './types';

// parse + validate a lora training manifest so the upload form can be polyfilled and the
// adapter checked against cloudflare's byo-lora requirements before it is ever pushed

export type ManifestSource = 'doc2lora' | 'peft' | 'unknown';

export type ParsedManifest = {
	source: ManifestSource;
	baseModelRaw: string;
	cfBaseModel: string | null;
	modelType: ModelType | null;
	rank: number | null;
	alpha: number | null;
	dropout: number | null;
	targetModules: string[];
	maxLength: number | null;
	peftType: string | null;
	quantized: boolean;
	advanced: string[];
};

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type ManifestCheck = { label: string; status: CheckStatus; message: string };
export type ManifestValidation = { ok: boolean; checks: ManifestCheck[] };

// known hugging-face base model names -> the dedicated cloudflare -lora base model id
const HF_TO_CF: Record<string, string> = {
	'mistralai/mistral-7b-instruct-v0.2': '@cf/mistral/mistral-7b-instruct-v0.2-lora',
	'google/gemma-7b-it': '@cf/google/gemma-7b-it-lora',
	'google/gemma-2b-it': '@cf/google/gemma-2b-it-lora',
	'meta-llama/llama-2-7b-chat-hf': '@cf/meta-llama/llama-2-7b-chat-hf-lora'
};

const CF_MODELS = new Set(DEFAULT_BASE_MODELS.map((m) => m.model));

// map a raw base model string (hf name or an already-cf id) to a supported cf -lora base
export function mapBaseModelToCf(raw: string): string | null {
	if (!raw) return null;
	const v = raw.trim();
	if (CF_MODELS.has(v)) return v;
	const lower = v.toLowerCase();
	if (HF_TO_CF[lower]) return HF_TO_CF[lower];

	for (const [hf, cf] of Object.entries(HF_TO_CF)) {
		const tail = hf.split('/').pop()!;
		if (lower.includes(tail)) return cf;
	}

	return null;
}

function modelTypeFor(cfModel: string | null, hinted?: string): ModelType | null {
	if (hinted && (MODEL_TYPES as readonly string[]).includes(hinted)) return hinted as ModelType;
	const match = DEFAULT_BASE_MODELS.find((m) => m.model === cfModel);
	return match?.modelType ?? null;
}

function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// accept either a doc2lora adapter.json or a peft adapter_config.json
export function parseManifest(input: unknown): ParsedManifest {
	const m = (input ?? {}) as Record<string, any>;
	const isPeft = typeof m.peft_type === 'string' || 'base_model_name_or_path' in m;
	const isDoc2lora = 'lora_config' in m || ('base_model' in m && 'model_type' in m);

	const baseModelRaw = String(m.base_model ?? m.base_model_name_or_path ?? '').trim();
	const cfBaseModel = mapBaseModelToCf(baseModelRaw);
	const modelType = modelTypeFor(cfBaseModel, m.model_type);

	const lc = (m.lora_config ?? {}) as Record<string, any>;
	const rank = num(m.r) ?? num(lc.r) ?? null;
	const alpha = num(m.lora_alpha) ?? num(lc.alpha) ?? null;
	const dropout = num(m.lora_dropout) ?? num(lc.dropout) ?? null;
	const targetModules: string[] = Array.isArray(m.target_modules)
		? m.target_modules
		: Array.isArray(lc.target_modules)
			? lc.target_modules
			: [];
	const maxLength = num(m.max_length);
	const peftType = typeof m.peft_type === 'string' ? m.peft_type : null;

	// cloudflare needs a plain, non-quantized lora; flag anything fancier
	const quantized = !!(m.use_qalora || (m.loftq_config && Object.keys(m.loftq_config).length));
	const advanced: string[] = [];
	if (m.use_dora) advanced.push('DoRA');
	if (m.use_rslora) advanced.push('rsLoRA');
	if (m.use_bdlora) advanced.push('bdLoRA');

	const source: ManifestSource = isDoc2lora ? 'doc2lora' : isPeft ? 'peft' : 'unknown';

	return {
		source,
		baseModelRaw,
		cfBaseModel,
		modelType,
		rank,
		alpha,
		dropout,
		targetModules,
		maxLength,
		peftType,
		quantized,
		advanced
	};
}

export function validateManifest(p: ParsedManifest): ManifestValidation {
	const checks: ManifestCheck[] = [];
	const add = (label: string, status: CheckStatus, message: string) =>
		checks.push({ label, status, message });

	// adapter type
	if (p.source === 'peft' && p.peftType && p.peftType.toUpperCase() !== 'LORA') {
		add('Adapter type', 'fail', `peft_type is "${p.peftType}"; Cloudflare only accepts LoRA`);
	} else {
		add('Adapter type', 'pass', 'LoRA adapter');
	}

	// base model
	if (p.cfBaseModel) {
		add('Base model', 'pass', `Maps to ${p.cfBaseModel}`);
	} else if (p.baseModelRaw) {
		add(
			'Base model',
			'fail',
			`"${p.baseModelRaw}" has no matching Cloudflare -lora base; inference will not run (downloads still work)`
		);
	} else {
		add('Base model', 'warn', 'No base model found in the manifest; pick one manually');
	}

	// model type
	if (p.modelType) {
		add('Model type', 'pass', p.modelType);
	} else {
		add('Model type', 'warn', 'Could not determine model_type; set it manually');
	}

	// rank
	if (p.rank == null) {
		add('Rank', 'warn', 'No rank found; set it manually');
	} else if (p.rank > CF_MAX_RANK) {
		add('Rank', 'fail', `Rank ${p.rank} exceeds the Cloudflare maximum of ${CF_MAX_RANK}`);
	} else {
		add('Rank', 'pass', `r = ${p.rank} (<= ${CF_MAX_RANK})`);
	}

	// quantization
	if (p.quantized) {
		add(
			'Quantization',
			'fail',
			'Adapter looks quantized (QLoRA/LoftQ); Cloudflare needs a plain LoRA'
		);
	} else {
		add('Quantization', 'pass', 'Non-quantized');
	}

	// advanced variants cloudflare may not serve
	if (p.advanced.length) {
		add('Variant', 'warn', `Uses ${p.advanced.join(', ')}; Cloudflare expects a vanilla LoRA`);
	}

	// target modules
	if (!p.targetModules.length) {
		add('Target modules', 'warn', 'No target_modules listed');
	}

	const ok = checks.every((c) => c.status !== 'fail');
	return { ok, checks };
}
