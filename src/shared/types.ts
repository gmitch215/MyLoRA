import type { Capability, RateTier } from './schemas';

export type Role = 'administrator' | 'manager' | 'developer';
export type ModelType = 'mistral' | 'gemma' | 'llama' | 'qwen';
export type Visibility = 'public' | 'unlisted' | 'private';
export type AdapterStatus =
	'draft' | 'listed' | 'pushing' | 'published' | 'failed' | 'archived' | 'migrated';

// statuses whose adapters can be run in the widget + playground
export const TESTABLE_STATUSES: AdapterStatus[] = ['published', 'migrated'];
export function isTestable(status: AdapterStatus): boolean {
	return TESTABLE_STATUSES.includes(status);
}

export type PublicUser = {
	id: string;
	username: string;
	displayName: string;
	role: Role;
	avatarPathname?: string | null;
	bio?: string | null;
};

export type AdminUser = PublicUser & {
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
	adapterCount: number;
};

export type AdapterExampleItem = { input: string; output?: string };

export type Adapter = {
	id: string;
	name: string;
	slug: string;
	description?: string | null;
	baseModel: string;
	modelType: ModelType;
	rank: number;
	configBytes: number;
	weightsBytes: number;
	promptTemplate?: string | null;
	tags: string[];
	examples: AdapterExampleItem[];
	screenshots: string[];
	iconName?: string | null;
	iconColor?: string | null;
	visibility: Visibility;
	cfPublic: boolean;
	accountId?: string | null;
	finetuneId?: string | null;
	finetuneName?: string | null;
	authorId?: string | null;
	author?: PublicUser | null;
	status: AdapterStatus;
	statusMessage?: string | null;
	downloadCount: number;
	inferenceCount: number;
	created_at: Date;
	updated_at: Date;
};

// never includes the token; only the last4 for display
export type PublicCloudflareAccount = {
	id: string;
	label: string;
	accountId: string;
	tokenLast4?: string | null;
	tokenScope: 'readwrite' | 'readonly';
	ownerId?: string | null;
	shared: boolean;
	isDefault: boolean;
	adapterCount: number;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
};

export type PermissionMatrix = { developer: Capability; manager: Capability };
export type RateLimits = { public: RateTier; developer: RateTier };

export type AccessSettings = {
	downloadAccess: 'public' | 'login';
	testerAccess: 'public' | 'login';
	defaultVisibility: Visibility;
};

export type LimitsSettings = {
	maxWeightsBytes: number;
	maxRank: number;
	maxScreenshots: number;
	gridPageSize: number;
	accountBudgetPerMinute: number;
	inferenceCacheTtl: number;
	maxOutputTokens: number;
	maxSystemPromptChars: number;
	logRetentionDays: number;
};

export type FeatureFlags = { cfGetEnabled: boolean; cfDeleteEnabled: boolean };

export type PushJob = {
	phase: 'create' | 'config' | 'weights' | 'done' | 'error';
	progress: number;
	attempt: number;
	error?: string;
	ts: number;
};

export type InferenceResult = {
	response: string;
	outputTokens: number;
	cached?: boolean;
};

// ----- remote training machines + jobs -----

export type ConnectionType = 'vps' | 'tunnel';
export type AuthMethod = 'key' | 'password';
// 'running' (a training job is active) and 'at_capacity' (GPU VRAM >= 80% used) are DERIVED for display
// by the machines list, not stored on the row
export type MachineHealth =
	| 'unchecked'
	| 'unknown'
	| 'ok'
	| 'unreachable'
	| 'auth_failed'
	| 'degraded'
	| 'running'
	| 'at_capacity';

// VRAM fraction at/above which a machine is considered too full to take another job
export const AT_CAPACITY_VRAM_PCT = 80;
export type TrainingEngine = 'doc2lora' | 'peft' | 'accelerate';
export type JobStatus =
	| 'queued'
	| 'provisioning'
	| 'launching'
	| 'running'
	| 'syncing'
	| 'verifying'
	| 'publishing'
	| 'completed'
	| 'failed'
	| 'abnormal'
	| 'aborted';
export type FailureClass =
	| 'none'
	| 'reported'
	| 'abnormal'
	| 'preflight'
	| 'verify'
	| 'sync'
	| 'aborted'
	// the training tool failed because a HuggingFace model/dataset is gated or the token lacks access (401)
	| 'gated';

// terminal states no longer get polled
export const TERMINAL_JOB_STATUSES: JobStatus[] = ['completed', 'failed', 'abnormal', 'aborted'];
export function isTerminalJob(status: JobStatus): boolean {
	return TERMINAL_JOB_STATUSES.includes(status);
}
export function isFailedJob(status: JobStatus): boolean {
	return status === 'failed' || status === 'abnormal';
}

export type GpuInfo = { name: string; vramMb: number; vramUsedMb?: number | null };

// a machine's manually-prepared dependency state (the "Prepare Machine" action builds a persistent
// venv that warms uv's wheel cache so training-job venvs install instantly; recorded in prepared.json)
export type MachinePrepared = {
	status: 'preparing' | 'ready';
	at: string;
	doc2loraExtras: 'core' | 'docs' | 'all';
	load4bit?: boolean;
	doc2loraVersion?: string | null;
	torch?: string | null;
	cuda?: string | null;
};

// does an installed doc2lora scope cover what a job needs? all >= docs >= core
export function doc2loraScopeCovers(
	installed: 'core' | 'docs' | 'all' | undefined | null,
	needed: 'core' | 'docs' | 'all'
): boolean {
	const rank = { core: 0, docs: 1, all: 2 } as const;
	if (!installed) return false;
	return rank[installed] >= rank[needed];
}

// richer box telemetry captured by Test Connection (the preflight probe)
export type SystemInfo = {
	hostname?: string | null;
	os?: string | null; // pretty name from /etc/os-release
	kernel?: string | null; // uname -r
	user?: string | null; // logged-in ssh user
	cpuModel?: string | null;
	cpuCores?: number | null;
	ramTotalMb?: number | null;
	ramAvailMb?: number | null;
	diskTotalGb?: number | null;
	diskAvailGb?: number | null;
	diskType?: string | null; // 'SSD' | 'HDD' (from the rotational flag)
	gpus?: GpuInfo[]; // every detected GPU (gpuInfo holds the primary one)
	prepared?: MachinePrepared | null; // manually-prepared dependency state (see "Prepare Machine")
	// huggingface token env var names already set on the box (HF_TOKEN/HF_API_KEY/...); the run reuses
	// them, so the launch modal can tell the user a token need not be pasted
	hfTokenEnv?: string[] | null;
	// uv wheel cache is warm (or a prep venv exists), so deps install in seconds even without an explicit
	// Prepare -> the launch modal should not alarm "Not Prepared"
	depsCached?: boolean | null;
};

// live box telemetry sampled by the probe while a job runs
export type JobTelemetry = {
	cpuPct?: number | null;
	ramUsedMb?: number | null;
	ramTotalMb?: number | null;
	gpuUtilPct?: number | null;
	vramUsedMb?: number | null;
	vramTotalMb?: number | null;
	diskAvailGb?: number | null;
	netRxMb?: number | null; // cumulative interface bytes (proxy for bandwidth used)
	netTxMb?: number | null;
	// the first sample's net counters, locked in as a baseline so the run's own consumption = current - baseline
	netRxMb0?: number | null;
	netTxMb0?: number | null;
	outputBytes?: number | null; // size of the out/ dir so far (est. adapter size)
	at?: string | null; // iso timestamp of the sample
};

// never includes any secret; only the public key + last4 + health surface
export type PublicMachine = {
	id: string;
	label: string;
	ownerId?: string | null;
	shared: boolean;
	host: string;
	port: number;
	username: string;
	authMethod: AuthMethod;
	connectionType: ConnectionType;
	keySource?: 'generated' | 'provided' | null;
	publicKey?: string | null;
	keyLast4?: string | null;
	hostKeyFingerprint?: string | null;
	hostKeyType?: string | null;
	healthStatus: MachineHealth;
	lastDiagnosis?: string | null;
	lastCheckedAt?: string | null;
	gpuInfo?: GpuInfo | null;
	systemInfo?: SystemInfo | null;
	toolingReady: boolean;
	hasSelfReport: boolean;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
};

export type TrainingConfigView = {
	baseModel: string;
	modelType?: ModelType | null;
	rank: number;
	loraAlpha: number;
	loraDropout: number;
	epochs: number;
	learningRate: number;
	maxLength: number;
	batchSize: number;
	gradientAccumulationSteps: number;
	load4bit: boolean;
	device: 'auto' | 'cuda' | 'mps' | 'cpu';
	targetModules: string[];
	// peft: huggingface dataset source
	hfDataset?: string | null;
	hfConfig?: string | null;
	hfSplit?: string | null;
	textField?: string | null;
	textTemplate?: string | null;
	captionColumn?: string | null;
	resolution?: number | null;
	maxSteps?: number | null;
	pythonFile?: string | null;
	abortOnError: boolean;
	useVenv?: boolean;
	pythonVersion?: string | null;
	// run the training process under sudo (the password is supplied per-launch, never persisted)
	useSudo?: boolean;
	// doc2lora parser scope: core (plain text) / docs (default) / all (adds audio+video)
	doc2loraExtras?: 'core' | 'docs' | 'all';
	// optional custom output adapter name + slug (defaults: "<machine> adapter" / "trained-<id>")
	outputName?: string | null;
	outputSlug?: string | null;
};

export type TrainingJobView = {
	id: string;
	machineId?: string | null;
	machineLabel?: string | null;
	authorId?: string | null;
	engine: TrainingEngine;
	status: JobStatus;
	statusMessage?: string | null;
	failureClass: FailureClass;
	datasetId?: string | null;
	inputKind: 'documents' | 'dataset';
	config: TrainingConfigView;
	autoPublish: boolean;
	autoUploadFinetune: boolean;
	accountId?: string | null;
	startedAt?: string | null;
	finishedAt?: string | null;
	lastHeartbeatAt?: string | null;
	consecutiveFailures: number;
	attempt: number;
	logTail?: string | null;
	adapterId?: string | null;
	adapterSize?: number | null;
	etaSeconds?: number | null;
	// true when the adapter is not CF-deployable (download from the job instead of the catalog)
	downloadOnly: boolean;
	// latest live box telemetry sampled by the probe (cpu/ram/vram/disk/net/output size)
	telemetry?: JobTelemetry | null;
	createdAt: string;
	updatedAt: string;
};

// a diagnosis from Test Connection / health checks, mapped to a specific cause
export type ConnectionDiagnosis = {
	ok: boolean;
	code: 'ok' | 'dns' | 'refused' | 'timeout' | 'auth' | 'host_key_changed' | 'protocol' | 'unknown';
	message: string;
	gpuInfo?: GpuInfo | null;
	systemInfo?: SystemInfo | null;
	toolingReady?: boolean;
	hostKeyFingerprint?: string | null;
};

// deterministic, order-of-magnitude training-time estimate from the doc2lora/peft timing tables;
// same inputs -> same answer (never an llm call). wide error bars - it is a planning hint only
export function estimateTrainingSeconds(opts: {
	corpusBytes: number;
	baseModel: string;
	gpu: 'cpu' | 'mps' | 'cuda';
	epochs?: number;
	load4bit?: boolean;
	// when the machine has not been prepared yet, the first run must download the whole ML stack
	// (torch + CUDA libs, ~GBs) before training starts; factor that cold-install time into the estimate
	toolingReady?: boolean;
}): number {
	const mb = Math.max(0.05, opts.corpusBytes / (1024 * 1024));
	const epochs = opts.epochs ?? 3;
	// small-model seconds-per-MB at 3 epochs, per device (doc2lora README table)
	const perMbSmall = opts.gpu === 'cuda' ? 12 : opts.gpu === 'mps' ? 55 : 360;
	const model = opts.baseModel.toLowerCase();
	// model-size multiplier vs the small test model
	const sizeMult = /32b/.test(model) ? 90 : /[^0-9]2b/.test(model) ? 8 : 30;
	// qlora fits + modestly speeds 7b/32b on cuda
	const quant = opts.load4bit && opts.gpu === 'cuda' ? 0.85 : 1;
	// fixed overhead: venv create + base model download (always) + a cold ML-stack install on a
	// machine that is not yet prepared (torch/cuda wheels are hundreds of MB to download once)
	const coldInstall = opts.toolingReady ? 0 : 300;
	const overhead = 120 + coldInstall;
	return Math.round(overhead + perMbSmall * mb * sizeMult * (epochs / 3) * quant);
}

// archives upload COMPRESSED but extract to a larger training corpus, so the raw upload size badly
// underestimates the work. inflate archive bytes (a rough 4x for text-heavy archives) so the byte-based
// estimate is sane; doc2lora's own `scan` (run on the box) gives the authoritative per-file breakdown
export const ARCHIVE_EXT_RE = /\.(zip|tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|7z|gz|bz2|xz)$/i;
export const ARCHIVE_INFLATION = 4;
export function estimatedCorpusBytes(files: { name: string; size: number }[]): number {
	return files.reduce(
		(sum, f) => sum + f.size * (ARCHIVE_EXT_RE.test(f.name) ? ARCHIVE_INFLATION : 1),
		0
	);
}

export function formatDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.round(totalSeconds));
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
	const d = Math.floor(h / 24);
	return `${d}d ${h % 24}h`;
}

// ----- live training progress (parsed from the remote train.log) -----

// a snapshot of where a run is, scraped from tqdm bars + HF Trainer dict logs. pure + deterministic
// (same log -> same answer; never an llm call) so it is shared by the server probe and the client modal
export type TrainingProgress = {
	percent: number | null; // 0-100
	step: number | null;
	totalSteps: number | null;
	epoch: number | null;
	// tqdm's own remaining-time estimate (seconds) from the [elapsed<remaining] bracket; most accurate
	tqdmRemainingSeconds: number | null;
	rate: string | null;
};

// parse "MM:SS" or "HH:MM:SS" into seconds (tqdm time format)
function clockToSeconds(s: string): number | null {
	const parts = s.split(':').map((p) => Number(p));
	if (parts.some((n) => !Number.isFinite(n))) return null;
	if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
	if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
	return null;
}

// tqdm bar:  " 45%|####5 | 450/1000 [00:30<00:37,  12.00it/s]" -> percent/step/total/remaining/rate.
// the remaining may be "?" early on. HF Trainer also logs {'loss':..,'epoch':1.5}; we take the LAST of each.
export function parseTrainingProgress(log?: string | null): TrainingProgress {
	const out: TrainingProgress = {
		percent: null,
		step: null,
		totalSteps: null,
		epoch: null,
		tqdmRemainingSeconds: null,
		rate: null
	};
	if (!log) return out;

	// setup/download bars use the SAME tqdm shape as the training bar (e.g. "Fetching 2 files: 0%|..|"
	// while the base model downloads, "Loading checkpoint shards", dataset "Map", "Resolving data
	// files"). counting those as training progress makes the eta burn down during the download, so we
	// match the bar PER LINE and skip lines carrying a setup label - only the training loop bar counts
	const SETUP_BAR =
		/fetching|downloading|resolving|loading checkpoint|checkpoint shards|^\s*map[:\s]|extract|upload/i;
	const bar =
		/(\d{1,3})%\s*\|[^|]*\|\s*(\d+)\/(\d+)\s*\[(\d+:\d+(?::\d+)?)<(\?|\d+:\d+(?::\d+)?)(?:,\s*([^\]]+))?\]/;
	let last: RegExpExecArray | null = null;
	for (const line of collapseCarriageReturns(log).split('\n')) {
		if (SETUP_BAR.test(line)) continue;
		const m = bar.exec(line);
		if (m) last = m;
	}
	if (last) {
		out.percent = Math.min(100, Math.max(0, Number(last[1])));
		out.step = Number(last[2]);
		out.totalSteps = Number(last[3]);
		out.tqdmRemainingSeconds = last[5] && last[5] !== '?' ? clockToSeconds(last[5]) : null;
		out.rate = last[6]?.trim() || null;
	}

	// epoch value may be a bare number or a quoted string (doc2lora prints 'epoch': '0.9091')
	const epochRe = /'epoch':\s*'?([\d.]+)'?/g;
	let e: RegExpExecArray | null;
	let lastEpoch: string | null = null;
	while ((e = epochRe.exec(log)) !== null) lastEpoch = e[1]!;
	if (lastEpoch != null) out.epoch = Number(lastEpoch);

	// percent fallback from step/total when tqdm did not print a percent token
	if (out.percent == null && out.step != null && out.totalSteps) {
		out.percent = Math.min(100, Math.round((out.step / out.totalSteps) * 100));
	}
	return out;
}

export type TrainingPhase = 'preparing' | 'loading' | 'training';

// a running job is one of: 'preparing' (venv + deps), 'loading' (base model downloading/loading), or
// 'training' (the loop is stepping). lets the ui hold the training eta countdown until real training
// begins, instead of burning it down during the model download
export function trainingPhase(log?: string | null): TrainingPhase | null {
	if (!log) return null;
	// real training-loop evidence (parseTrainingProgress already ignores download/setup bars)
	const p = parseTrainingProgress(log);
	if (p.step != null || /'loss':/.test(log) || /\*{3,}\s*Running training/i.test(log))
		return 'training';
	// the train command launched but the model is still loading/downloading
	if (
		/\[train\] starting/.test(log) ||
		/Loading model|Fetching \d+ files|checkpoint shards/i.test(log)
	)
		return 'loading';
	return 'preparing';
}

// doc2lora's `scan` prints a real per-machine time estimate from the extracted text ("Estimated
// training time (~small model): 5 minutes"). that is far more accurate than our byte heuristic, so we
// parse it to replace the pre-launch estimate once the scan runs. returns seconds, or null.
export function parseScanEstimateSeconds(log?: string | null): number | null {
	if (!log) return null;
	const m = log.match(/Estimated training time[^:]*:\s*~?\s*([\d.]+)\s*(second|minute|hour)/i);
	if (!m) return null;
	const n = Number(m[1]);
	if (!Number.isFinite(n) || n <= 0) return null;
	const unit = (m[2] || '').toLowerCase();
	const mult = unit.startsWith('hour') ? 3600 : unit.startsWith('minute') ? 60 : 1;
	return Math.round(n * mult);
}

export type TrainingPoint = {
	step: number;
	loss: number | null;
	gradNorm: number | null;
	lr: number | null;
	epoch: number | null;
};

// the final Trainer summary dict ({'train_runtime': .., 'train_samples_per_second': .., ..})
export type TrainingSummary = {
	trainRuntime: number | null; // seconds the training loop ran
	samplesPerSecond: number | null;
	stepsPerSecond: number | null;
	trainLoss: number | null; // mean loss over the whole run
	epoch: number | null; // epochs completed
};
export type TrainingSeries = {
	points: TrainingPoint[];
	finalLoss: number | null;
	finalGradNorm: number | null;
	finalLr: number | null;
	finalEpoch: number | null;
	summary: TrainingSummary | null;
};

// pull a numeric value (bare or quoted) for a key out of a one-line dict chunk
function dictNum(chunk: string, key: string): number | null {
	const mm = chunk.match(new RegExp(`'${key}':\\s*'?([\\d.eE+-]+)'?`));
	if (!mm) return null;
	const n = Number(mm[1]);
	return Number.isFinite(n) ? n : null;
}

// extract the per-log-step loss / grad-norm / learning-rate / epoch series + the final summary dict
// from HF Trainer's logs for the completion charts. values may be bare numbers OR quoted strings
// (doc2lora prints {'loss': '3.062', 'grad_norm': '1.051', 'learning_rate': '0.0004', 'epoch': '0.9091'})
export function parseTrainingSeries(log?: string | null): TrainingSeries {
	const points: TrainingPoint[] = [];
	const empty: TrainingSeries = {
		points,
		finalLoss: null,
		finalGradNorm: null,
		finalLr: null,
		finalEpoch: null,
		summary: null
	};
	if (!log) return empty;
	try {
		// each Trainer step log is a one-line dict carrying a 'loss' key (the final summary uses 'train_loss')
		const re = /\{[^{}]*'loss':\s*'?[\d.eE+-]+'?[^{}]*\}/g;
		let m: RegExpExecArray | null;
		let i = 0;
		while ((m = re.exec(log)) !== null) {
			const chunk = m[0];
			points.push({
				step: ++i,
				loss: dictNum(chunk, 'loss'),
				gradNorm: dictNum(chunk, 'grad_norm'),
				lr: dictNum(chunk, 'learning_rate'),
				epoch: dictNum(chunk, 'epoch')
			});
		}
		// the final summary dict (mean loss, runtime, throughput) - a separate one-line dict
		let summary: TrainingSummary | null = null;
		const sm = log.match(/\{[^{}]*'train_runtime':[^{}]*\}/);
		if (sm) {
			const c = sm[0];
			summary = {
				trainRuntime: dictNum(c, 'train_runtime'),
				samplesPerSecond: dictNum(c, 'train_samples_per_second'),
				stepsPerSecond: dictNum(c, 'train_steps_per_second'),
				trainLoss: dictNum(c, 'train_loss'),
				epoch: dictNum(c, 'epoch')
			};
		}
		const last = points[points.length - 1];
		return {
			points,
			finalLoss: last?.loss ?? null,
			finalGradNorm: last?.gradNorm ?? null,
			finalLr: last?.lr ?? null,
			finalEpoch: last?.epoch ?? null,
			summary
		};
	} catch {
		// malformed log -> show no metrics rather than wrong ones
		return empty;
	}
}

export type PhaseTiming = { label: string; seconds: number };

// seconds-of-day from either our [HH:MM:SS] milestone marker or a python-logging timestamp
function logTimeSeconds(line: string): number | null {
	let m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
	if (!m) m = line.match(/\b\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2}):(\d{2})/);
	if (!m) return null;
	return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// duration of each run phase (Install, Scan, Training) from the timestamped milestone markers, so the
// details modal can compare setup time vs training time. monotonic across a midnight-utc wrap. any
// malformed/out-of-order timestamps yield a dropped phase rather than a bogus duration (prefer no data).
const MAX_PLAUSIBLE_PHASE_S = 86400; // a single phase over 24h is almost certainly a parse artifact
export function parsePhaseTimings(log?: string | null): PhaseTiming[] {
	if (!log) return [];
	try {
		let prev = -1;
		let offset = 0;
		let last = -1;
		const at: Record<string, number> = {};
		for (const line of collapseCarriageReturns(log).split('\n')) {
			const raw = logTimeSeconds(line);
			if (raw == null || !Number.isFinite(raw)) continue;
			let t = raw + offset;
			if (prev >= 0 && t < prev) {
				offset += 86400;
				t = raw + offset;
			}
			prev = t;
			last = t;
			if (/\[venv\]/.test(line) && at.venv == null) at.venv = t;
			else if (/\[scan\]/.test(line) && at.scan == null) at.scan = t;
			else if (/\[train\] starting/.test(line) && at.train == null) at.train = t;
		}
		const out: PhaseTiming[] = [];
		const push = (label: string, a?: number, b?: number) => {
			// only a positive, plausible duration is real; anything else is a parse artifact -> drop it
			if (a == null || b == null) return;
			const d = b - a;
			if (d > 0 && d <= MAX_PLAUSIBLE_PHASE_S) out.push({ label, seconds: d });
		};
		push('Install', at.venv, at.scan ?? at.train ?? (last >= 0 ? last : undefined));
		if (at.scan != null) push('Scan', at.scan, at.train ?? (last >= 0 ? last : undefined));
		push('Training', at.train, last >= 0 ? last : undefined);
		return out;
	} catch {
		// malformed log -> show nothing rather than wrong timings
		return [];
	}
}

// collapse carriage-return overwrites for DISPLAY, the way a terminal renders them: a lone `\r`
// returns the cursor to column 0 so the following text overwrites the line. tqdm redraws its progress
// bar with `\r` (no newline until the bar finishes), so without this every frame concatenates into one
// jumbled line. we keep only the text after each line's last `\r` (its final frame). the RAW log is
// untouched on disk / in the download - this is purely a render-time cleanup.
export function collapseCarriageReturns(raw?: string | null): string {
	if (!raw) return '';
	return raw
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => {
			const i = line.lastIndexOf('\r');
			return i === -1 ? line : line.slice(i + 1);
		})
		.join('\n');
}

// resolve a single percent (0-100) for the progress bar, preferring the most reliable signal
export function progressPercent(p: TrainingProgress, totalEpochs?: number | null): number | null {
	if (p.percent != null) return p.percent;
	if (p.step != null && p.totalSteps) return Math.round((p.step / p.totalSteps) * 100);
	if (p.epoch != null && totalEpochs)
		return Math.min(100, Math.round((p.epoch / totalEpochs) * 100));
	return null;
}

// best-available countdown (seconds remaining): tqdm's own estimate > percent extrapolation from
// elapsed > step extrapolation > the static planning estimate minus elapsed. null when unknowable.
export function trainingEtaSeconds(opts: {
	progress: TrainingProgress;
	startedAtMs: number | null;
	nowMs: number;
	totalEpochs?: number | null;
	fallbackEtaSeconds?: number | null;
}): number | null {
	const { progress: p, startedAtMs, nowMs } = opts;
	if (p.tqdmRemainingSeconds != null) return Math.max(0, p.tqdmRemainingSeconds);

	const elapsed = startedAtMs ? (nowMs - startedAtMs) / 1000 : null;
	const pct = progressPercent(p, opts.totalEpochs);
	if (elapsed != null && elapsed > 0 && pct != null && pct > 0 && pct < 100) {
		return Math.round((elapsed * (100 - pct)) / pct);
	}
	if (elapsed != null && elapsed > 0 && p.step && p.totalSteps && p.step > 0) {
		const per = elapsed / p.step;
		return Math.max(0, Math.round(per * (p.totalSteps - p.step)));
	}
	if (opts.fallbackEtaSeconds != null) {
		if (elapsed != null) return Math.max(0, Math.round(opts.fallbackEtaSeconds - elapsed));
		return opts.fallbackEtaSeconds;
	}
	return null;
}

export function formatDate(date: Date | string) {
	return new Date(date).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

// absolute date + time, e.g. "Jun 30, 6:11 PM"
export function formatDateTime(date: Date | string) {
	return new Date(date).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
