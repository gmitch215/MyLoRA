import type { GpuInfo, JobTelemetry, SystemInfo } from '../../shared/types';

export type RemoteTrainingConfig = {
	baseModel: string;
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
	// peft: huggingface dataset source (no upload)
	hfDataset?: string | null;
	hfConfig?: string | null;
	hfSplit?: string | null;
	textField?: string | null;
	textTemplate?: string | null;
	// accelerate (diffusers text-to-image LoRA)
	captionColumn?: string | null;
	resolution?: number | null;
	maxSteps?: number | null;
	// run isolation (default-on); pythonVersion drives `uv venv --python`
	useVenv?: boolean;
	pythonVersion?: string | null;
	// run the training process under sudo (hardware/driver access); password supplied per-launch
	useSudo?: boolean;
	// doc2lora parser scope: core (plain text) / docs (default) / all (adds audio+video)
	doc2loraExtras?: Doc2LoraExtras;
};

export type TrainingEngineName = 'doc2lora' | 'peft' | 'accelerate';

// pinned diffusers release whose example script + package we use for the accelerate engine
export const DIFFUSERS_REF = 'v0.31.0';
export const DIFFUSERS_TRAIN_URL = `https://raw.githubusercontent.com/huggingface/diffusers/${DIFFUSERS_REF}/examples/text_to_image/train_text_to_image_lora.py`;

// the trained-weights filename each engine produces (diffusers uses pytorch_lora_weights)
export function outputWeightsName(engine: TrainingEngineName): string {
	return engine === 'accelerate' ? 'pytorch_lora_weights.safetensors' : 'adapter_model.safetensors';
}

// whether the engine emits an adapter_config.json alongside the weights (diffusers does not)
export function hasAdapterConfig(engine: TrainingEngineName): boolean {
	return engine !== 'accelerate';
}

export type Doc2LoraExtras = 'core' | 'docs' | 'all';
const DOC2LORA_GIT = 'git+https://github.com/earth-app/doc2lora.git';

export function doc2loraPipSpec(extras: Doc2LoraExtras = 'docs'): string {
	const tag = extras === 'all' ? '[all]' : extras === 'core' ? '' : '[docs]';
	return `doc2lora${tag} @ ${DOC2LORA_GIT}`;
}

// kept for back-compat (the default `docs` scope)
export const DOC2LORA_PIP_SPEC = doc2loraPipSpec('docs');

// single-quote a shell token safely (close-quote, escaped quote, reopen)
export function shq(s: string): string {
	return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// root job directory on the remote box; jobId is a uuid so it doubles as the wrapper-identity marker
export function jobDirFor(jobId: string): string {
	return `/tmp/mylora-jobs/${jobId}`;
}

export const TRAIN_PEFT_PY = `#!/usr/bin/env python3
import argparse, os, re
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments, DataCollatorForLanguageModeling
from datasets import load_dataset

p = argparse.ArgumentParser()
p.add_argument('--base-model', required=True)
p.add_argument('--job-dir', required=True)
p.add_argument('--hf-dataset', required=True)
p.add_argument('--hf-config', default='')
p.add_argument('--hf-split', default='train')
p.add_argument('--text-field', default='')
p.add_argument('--text-template', default='')
p.add_argument('--rank', type=int, default=8)
p.add_argument('--lora-alpha', type=int, default=16)
p.add_argument('--lora-dropout', type=float, default=0.1)
p.add_argument('--epochs', type=int, default=3)
p.add_argument('--learning-rate', type=float, default=5e-4)
p.add_argument('--max-length', type=int, default=512)
p.add_argument('--batch-size', type=int, default=4)
p.add_argument('--grad-accum', type=int, default=1)
p.add_argument('--load-in-4bit', action='store_true')
p.add_argument('--target-modules', default='')
a = p.parse_args()

tok = AutoTokenizer.from_pretrained(a.base_model)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token

kwargs = {}
if a.load_in_4bit:
    from transformers import BitsAndBytesConfig
    kwargs['quantization_config'] = BitsAndBytesConfig(load_in_4bit=True)
model = AutoModelForCausalLM.from_pretrained(a.base_model, **kwargs)

target = [m for m in a.target_modules.split(',') if m] or None
cfg = LoraConfig(r=a.rank, lora_alpha=a.lora_alpha, lora_dropout=a.lora_dropout,
                 target_modules=target, bias='none', task_type='CAUSAL_LM')
model = get_peft_model(model, cfg)
model.print_trainable_parameters()

ds = load_dataset(a.hf_dataset, a.hf_config or None, split=a.hf_split)

def to_text(ex):
    if a.text_template:
        return re.sub(r'\\{(\\w+)\\}', lambda m: str(ex.get(m.group(1), '')), a.text_template)
    if a.text_field:
        return str(ex.get(a.text_field, ''))
    if 'text' in ex:
        return str(ex['text'])
    for v in ex.values():
        if isinstance(v, str):
            return v
    return ''

def tok_fn(ex):
    return tok(to_text(ex), truncation=True, max_length=a.max_length)
ds = ds.map(tok_fn, remove_columns=ds.column_names)

args = TrainingArguments(output_dir=os.path.join(a.job_dir, 'work'),
                         per_device_train_batch_size=a.batch_size,
                         gradient_accumulation_steps=a.grad_accum,
                         learning_rate=a.learning_rate, num_train_epochs=a.epochs,
                         logging_steps=10, save_strategy='no', report_to=[])
Trainer(model=model, args=args, train_dataset=ds,
        data_collator=DataCollatorForLanguageModeling(tok, mlm=False)).train()
model.save_pretrained(os.path.join(a.job_dir, 'out'))
`;

export function buildDoc2LoraArgs(
	jobDir: string,
	config: RemoteTrainingConfig,
	exe = `${jobDir}/venv/bin/doc2lora`
): string[] {
	const args = [
		exe,
		'convert',
		`${jobDir}/input`,
		'--output',
		`${jobDir}/out`,
		'--model',
		config.baseModel,
		'--lora-r',
		String(config.rank),
		'--lora-alpha',
		String(config.loraAlpha),
		'--lora-dropout',
		String(config.loraDropout),
		'--epochs',
		String(config.epochs),
		'--learning-rate',
		String(config.learningRate),
		'--batch-size',
		String(config.batchSize),
		'--max-length',
		String(config.maxLength),
		'--gradient-accumulation-steps',
		String(config.gradientAccumulationSteps),
		'--device',
		config.device
	];
	if (config.load4bit) args.push('--load-in-4bit');
	return args;
}

export function buildPeftArgs(
	jobDir: string,
	config: RemoteTrainingConfig,
	python = `${jobDir}/venv/bin/python`
): string[] {
	const args = [
		python,
		`${jobDir}/train_peft.py`,
		'--base-model',
		config.baseModel,
		'--job-dir',
		jobDir,
		'--hf-dataset',
		config.hfDataset || '',
		'--hf-config',
		config.hfConfig || '',
		'--hf-split',
		config.hfSplit || 'train',
		'--text-field',
		config.textField || '',
		'--text-template',
		config.textTemplate || '',
		'--rank',
		String(config.rank),
		'--lora-alpha',
		String(config.loraAlpha),
		'--lora-dropout',
		String(config.loraDropout),
		'--epochs',
		String(config.epochs),
		'--learning-rate',
		String(config.learningRate),
		'--max-length',
		String(config.maxLength),
		'--batch-size',
		String(config.batchSize),
		'--grad-accum',
		String(config.gradientAccumulationSteps)
	];
	if (config.load4bit) args.push('--load-in-4bit');
	if (config.targetModules.length) args.push('--target-modules', config.targetModules.join(','));
	return args;
}

export function enginePackages(
	engine: TrainingEngineName,
	load4bit: boolean,
	doc2loraExtras: Doc2LoraExtras = 'docs'
): string[] {
	let base: string[];
	if (engine === 'doc2lora') base = [doc2loraPipSpec(doc2loraExtras)];
	else if (engine === 'accelerate')
		base = [
			`diffusers==${DIFFUSERS_REF.replace(/^v/, '')}`,
			'accelerate',
			'transformers',
			'datasets',
			'peft',
			'torch',
			'torchvision',
			'safetensors',
			'Pillow'
		];
	else base = ['peft', 'transformers', 'accelerate', 'datasets', 'torch', 'safetensors'];
	if (load4bit) base.push('bitsandbytes');
	return base;
}

export function buildInstallArgs(engine: TrainingEngineName, load4bit: boolean): string[][] {
	return [
		['install', '--upgrade', 'pip'],
		['install', ...enginePackages(engine, load4bit)]
	];
}

// accelerate launch argv for the diffusers text-to-image LoRA script (download-only diffusion LoRA)
export function buildAccelerateArgs(
	jobDir: string,
	config: RemoteTrainingConfig,
	accelerate = `${jobDir}/venv/bin/accelerate`
): string[] {
	const args = [
		accelerate,
		'launch',
		'--mixed_precision',
		'fp16',
		`${jobDir}/train_accelerate.py`,
		'--pretrained_model_name_or_path',
		config.baseModel,
		'--dataset_name',
		config.hfDataset || '',
		'--caption_column',
		config.captionColumn || 'text',
		'--resolution',
		String(config.resolution ?? 512),
		'--center_crop',
		'--random_flip',
		'--train_batch_size',
		String(config.batchSize),
		'--gradient_accumulation_steps',
		String(config.gradientAccumulationSteps),
		'--learning_rate',
		String(config.learningRate),
		'--lr_scheduler',
		'cosine',
		'--lr_warmup_steps',
		'0',
		'--rank',
		String(config.rank),
		'--seed',
		'1337',
		'--output_dir',
		`${jobDir}/out`
	];
	// diffusers uses a step budget (no --num_train_epochs default that terminates); default if unset
	args.push('--max_train_steps', String(config.maxSteps ?? 1000));
	return args;
}

export function buildRunScript(opts: {
	jobDir: string;
	engine: TrainingEngineName;
	config: RemoteTrainingConfig;
	// optional per-job huggingface token; takes precedence over any token already on the box
	hfToken?: string | null;
	// 1-based attempt number; stamped as a banner at the top of train.log (each attempt overwrites it)
	attempt?: number;
	// username that launched the job; stamped into the log for attribution
	requestedBy?: string | null;
}): string {
	const { jobDir, engine, config, hfToken, requestedBy } = opts;
	const attempt = Math.max(1, Math.trunc(opts.attempt ?? 1));
	const useVenv = config.useVenv !== false; // default-on
	const useSudo = config.useSudo === true;
	const pyVersion = (config.pythonVersion || '3.11').trim();
	const pkgs = enginePackages(engine, config.load4bit, config.doc2loraExtras).map(shq).join(' ');
	const bin = (name: string) =>
		useVenv ? `${jobDir}/venv/bin/${name}` : name === 'python' ? 'python3' : name;
	const outName = outputWeightsName(engine);

	// engine-specific extra setup (accelerate downloads the diffusers script + a default config) and
	// the train invocation
	let extraSetup = '';
	let trainArgs: string[];
	if (engine === 'doc2lora') {
		// scan first: doc2lora's own per-file breakdown + time estimate (archive-aware, on real extracted
		// text), echoed into the log before training begins
		extraSetup = `say "[scan] doc2lora per-file breakdown + time estimate"
  ${shq(bin('doc2lora'))} scan ${shq(`${jobDir}/input`)} --device ${shq(config.device)} || true`;
		trainArgs = buildDoc2LoraArgs(jobDir, config, bin('doc2lora'));
	} else if (engine === 'accelerate') {
		extraSetup = `say "[accelerate] fetching the diffusers text-to-image LoRA script (${DIFFUSERS_REF})"
  curl -LsSf ${shq(DIFFUSERS_TRAIN_URL)} -o "$JOB_DIR/train_accelerate.py"
  ${shq(bin('accelerate'))} config default`;
		trainArgs = buildAccelerateArgs(jobDir, config, bin('accelerate'));
	} else {
		trainArgs = buildPeftArgs(jobDir, config, bin('python'));
	}
	const trainCmd = trainArgs.map(shq).join(' ');

	// venv binaries when isolated; system binaries (debian needs --break-system-packages) otherwise
	const venvPip = `${jobDir}/venv/bin/pip`;
	const venvPy = `${jobDir}/venv/bin/python`;

	// robust, debian-proof venv: PREFER uv with a MANAGED cpython (--python-preference only-managed) so
	// it downloads a clean python-build-standalone interpreter and NEVER touches the system python -
	// whose pip/certifi can be broken (the homebox: circular pip._vendor.requests import + missing
	// cacert.pem). installs go through `uv pip` (uv's own resolver + TLS + on-disk wheel cache), not the
	// venv's pip, so a corrupt system toolchain cannot poison them AND wheels are reused across jobs.
	// a HEALTHY existing venv is reused as-is (no rm -rf, no re-create) so a retry never re-downloads the
	// stack; only a missing/partial venv is (re)built. uv pip is idempotent - satisfied packages are
	// skipped, missing ones come from the cache when present. this keeps box bandwidth to a single
	// first-ever download.
	const setup = useVenv
		? `say "[venv] preparing isolated environment (python ${pyVersion})"
  if ! command -v uv >/dev/null 2>&1; then
    say "[venv] uv not found; bootstrapping (sidesteps the system python toolchain)"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  fi
  if [ -x "$JOB_DIR/venv/bin/python" ]; then
    say "[venv] reusing the existing venv (skips re-downloading the stack)"
  elif command -v uv >/dev/null 2>&1; then
    say "[venv] creating venv with a uv-managed cpython ${pyVersion} (ignores the system python)"
    rm -rf "$JOB_DIR/venv"
    uv venv --python-preference only-managed --python ${shq(pyVersion)} "$JOB_DIR/venv"
  else
    say "[venv] uv unavailable; falling back to the stdlib venv module"
    rm -rf "$JOB_DIR/venv"
    python3 -m venv --clear "$JOB_DIR/venv"
  fi
  if command -v uv >/dev/null 2>&1; then
    say "[venv] installing packages via uv pip (cached wheels are reused across jobs)"
    uv pip install --python ${shq(venvPy)} ${pkgs}
  else
    ${shq(venvPip)} install --upgrade pip
    ${shq(venvPip)} install ${pkgs}
  fi`
		: `say "[venv] disabled - installing into the system python (debian: --break-system-packages)"
  python3 -m pip install --upgrade pip --break-system-packages 2>/dev/null || true
  python3 -m pip install ${pkgs} --break-system-packages`;

	const d = shq(jobDir);

	// a per-job token is injected as HF_TOKEN first so it wins the cross-population below
	const injectToken = hfToken ? `export HF_TOKEN=${shq(hfToken)}\n` : '';

	// sudo: run the TRAINING command elevated (setup stays as the user; uv needs no root)
	const sudoHelper = useSudo
		? `run_train() {
  RUNAS="\${SUDO_RUNAS:-}"; ME="$(id -un 2>/dev/null || whoami)"
  # sudo resets the environment by default, so pass the hf token through explicitly as argv via env
  HFENV=""
  if [ -n "\${HF_TOKEN:-}" ]; then HFENV="HF_TOKEN=$HF_TOKEN HF_API_KEY=$HF_TOKEN HUGGINGFACE_API_TOKEN=$HF_TOKEN HUGGING_FACE_HUB_TOKEN=$HF_TOKEN"; fi
  if [ -n "$RUNAS" ] && [ "$RUNAS" != "$ME" ]; then
    printf '%s\\n' "\${SUDO_PW:-}" | sudo -S -p '' -u "$RUNAS" -- env $HFENV "$@"
  elif [ -n "\${SUDO_PW:-}" ]; then
    printf '%s\\n' "\$SUDO_PW" | sudo -S -p '' -- env $HFENV "$@"
  else
    sudo -n -- env $HFENV "$@"
  fi
}
`
		: '';
	const trainLine = useSudo ? `run_train ${trainCmd}` : trainCmd;
	return `#!/usr/bin/env bash
set -uo pipefail
umask 022
JOB_DIR=${d}
mkdir -p "$JOB_DIR/out"
echo $$ > "$JOB_DIR/meta.pid"
# resolve a huggingface token the box already has. a non-interactive ssh exec does NOT load the shell
# rc, and rc files commonly set HF vars AFTER an interactive-only guard, so sourcing them here misses
# an export HF_API_KEY in .bashrc. we therefore (1) source the profiles, (2) ask a real interactive
# login shell for the vars (catches the .bashrc case), and (3) fall back to the hf cli token file.
# doc2lora/hf_hub honor ONLY HF_TOKEN, so we mirror onto every name
set +u
for f in /etc/environment "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc"; do
  [ -r "$f" ] && . "$f" >/dev/null 2>&1 || true
done
if command -v bash >/dev/null 2>&1; then
  # -ic = interactive non-login (sources .bashrc, the usual spot); -lic = interactive login (profiles)
  for _m in -ic -lic; do
    while read -r _tag _n _v; do [ -n "$_v" ] && export "$_n=$_v"; done < <(bash $_m 'for v in HF_TOKEN HF_API_KEY HUGGINGFACE_API_TOKEN HUGGING_FACE_HUB_TOKEN; do val=$(printenv "$v" 2>/dev/null); [ -n "$val" ] && printf "@@HF@@ %s %s\\n" "$v" "$val"; done' 2>/dev/null | grep "^@@HF@@ ")
  done
fi
set -u
${injectToken}HF="\${HF_TOKEN:-\${HF_API_KEY:-\${HUGGINGFACE_API_TOKEN:-\${HUGGING_FACE_HUB_TOKEN:-}}}}"
if [ -z "$HF" ]; then
  for tf in "\${HF_HOME:-$HOME/.cache/huggingface}/token" "$HOME/.huggingface/token"; do
    if [ -r "$tf" ]; then HF=$(tr -d '\\r\\n' < "$tf"); [ -n "$HF" ] && break; fi
  done
fi
if [ -n "$HF" ]; then export HF_TOKEN="$HF" HF_API_KEY="$HF" HUGGINGFACE_API_TOKEN="$HF" HUGGING_FACE_HUB_TOKEN="$HF"; fi
# timestamp our own milestone lines (tool output keeps its own timing)
say() { printf '[%s] %s\\n' "$(date -u +%H:%M:%S)" "$*"; }
${sudoHelper}# heartbeat + live telemetry sampler (written atomically each tick for the probe to read)
( while true; do
    date +%s > "$JOB_DIR/heartbeat"
    {
      read -r _ c_u c_n c_s c_i _rest < /proc/stat 2>/dev/null || true
      t1=$((c_u+c_n+c_s+c_i)); i1=$c_i
      sleep 1
      read -r _ c_u c_n c_s c_i _rest < /proc/stat 2>/dev/null || true
      t2=$((c_u+c_n+c_s+c_i)); i2=$c_i; dt=$((t2-t1)); di=$((i2-i1))
      if [ "$dt" -gt 0 ]; then echo "cpu=$(( (100*(dt-di))/dt ))"; else echo "cpu="; fi
      echo "gpu=$(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)"
      echo "mem=$(free -m 2>/dev/null | awk '/^Mem:/{print $3","$2}')"
      echo "disk=$(df -BG "$JOB_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
      echo "net=$(awk 'NR>2{gsub(/:/," "); rx+=$2; tx+=$10} END{print rx","tx}' /proc/net/dev 2>/dev/null)"
      echo "out=$(du -sb "$JOB_DIR/out" 2>/dev/null | cut -f1)"
    } > "$JOB_DIR/telemetry.tmp" 2>/dev/null && mv -f "$JOB_DIR/telemetry.tmp" "$JOB_DIR/telemetry" 2>/dev/null
    sleep 14
  done ) &
HB=$!
trap 'kill "$HB" 2>/dev/null || true' EXIT
# subshell so set -e is CONTAINED: a setup/train failure exits the subshell, never this script, so the
# done.json sentinel below is always written (otherwise the run looks "abnormal" with no exit code)
(
  set -e
  say "===== Attempt #${attempt} - ${engine} ====="
  ${requestedBy ? `say ${shq(`[job] requested by ${requestedBy}`)}\n  ` : ''}if [ -n "\${HF_TOKEN:-}" ]; then say "[hf] a huggingface token was found on the box; gated models will authenticate"; else say "[hf] NO huggingface token found on the box; gated models (llama/gemma/mistral) will fail with 401"; fi
  ${setup}
  ${extraSetup ? `${extraSetup}\n  ` : ''}say "[train] starting ${engine}${useSudo ? ' (sudo)' : ''}"
  ${trainLine}
) > "$JOB_DIR/train.log" 2>&1
STATUS=$?
if [ "$STATUS" -eq 0 ] && [ -f "$JOB_DIR/out/${outName}" ]; then
  SHA=$(sha256sum "$JOB_DIR/out/${outName}" | cut -d' ' -f1)
  SZ=$(stat -c%s "$JOB_DIR/out/${outName}")
  printf '{"status":"success","sha256":"%s","size":%s}' "$SHA" "$SZ" > "$JOB_DIR/done.json.tmp"
else
  printf '{"status":"failed","exitCode":%s}' "$STATUS" > "$JOB_DIR/done.json.tmp"
fi
mv -f "$JOB_DIR/done.json.tmp" "$JOB_DIR/done.json"
`;
}

// the launcher: detach the run script so it survives the channel closing; echo the child PID. the
// optional sudo password is injected as an env var (SUDO_PW) - present only in the launched process's
// environment, never written to run.sh on disk and never persisted
export function buildLaunchCommand(
	jobDir: string,
	sudoPassword?: string | null,
	sudoUser?: string | null
): string {
	const d = shq(jobDir);
	const parts: string[] = [];
	if (sudoPassword) parts.push(`SUDO_PW=${shq(sudoPassword)}`);
	if (sudoUser) parts.push(`SUDO_RUNAS=${shq(sudoUser)}`);
	const envPrefix = parts.length ? `${parts.join(' ')} ` : '';
	// CRITICAL: redirect stdin from /dev/null too. without `</dev/null` the detached process inherits
	// the ssh channel's stdin, so the server keeps the exec channel OPEN until run.sh exits - the exec
	// call would then block for the entire (multi-minute) run, stranding the job in 'provisioning' with
	// no logs. detaching all three fds lets the exec return immediately with the pid.
	return `${envPrefix}setsid nohup bash ${d}/run.sh </dev/null >/dev/null 2>&1 & echo "$!"`;
}

// a single probe command: emit the sentinel, heartbeat, pid/cmdline, and a tail of the train log
export function buildProbeCommand(jobDir: string, pid: number): string {
	const d = shq(jobDir);
	const p = String(Math.trunc(pid));
	return `D=${d}; echo '@@DONE@@'; cat "$D/done.json" 2>/dev/null; echo; echo '@@HB@@'; cat "$D/heartbeat" 2>/dev/null; echo; echo '@@PID@@'; if kill -0 ${p} 2>/dev/null; then (tr '\\0' ' ' < /proc/${p}/cmdline 2>/dev/null) || echo ALIVE; fi; echo; echo '@@LOG@@'; tail -c 16000 "$D/train.log" 2>/dev/null; echo; echo '@@TEL@@'; cat "$D/telemetry" 2>/dev/null; echo; echo '@@END@@'`;
}

// full system telemetry + python/pip + sudo capability, between markers. GPU section lists EVERY gpu
// (name, total MB, used MB) one per line; the rest is cpu/ram/disk/os/user for the Test Connection view
export function buildPreflightCommand(): string {
	return [
		`echo '@@GPU@@'`,
		`nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits 2>/dev/null`,
		`echo '@@PY@@'`,
		`python3 --version 2>&1`,
		`echo '@@PIP@@'`,
		`(python3 -m pip --version 2>/dev/null || echo MISSING)`,
		`echo '@@SUDO@@'`,
		`(sudo -n true 2>/dev/null && echo YES || echo NO)`,
		`echo '@@CPU@@'`,
		`(sed -n 's/^model name[[:space:]]*: //p' /proc/cpuinfo 2>/dev/null | head -1)`,
		`echo '@@CORES@@'`,
		`(nproc 2>/dev/null)`,
		`echo '@@MEM@@'`,
		`(free -m 2>/dev/null | awk '/^Mem:/{print $2","$7}')`,
		`echo '@@DISK@@'`,
		`(df -BG /tmp 2>/dev/null | awk 'NR==2{print $2","$4}')`,
		`echo '@@ROTA@@'`,
		`(lsblk -ndo rota "$(df --output=source /tmp 2>/dev/null | tail -1)" 2>/dev/null | head -1)`,
		`echo '@@OS@@'`,
		`(. /etc/os-release 2>/dev/null; printf '%s' "$PRETTY_NAME")`,
		`echo '@@KERNEL@@'`,
		`(uname -r 2>/dev/null)`,
		`echo '@@USER@@'`,
		`(id -un 2>/dev/null || whoami)`,
		`echo '@@HOST@@'`,
		`(hostname 2>/dev/null)`,
		`echo '@@HFENV@@'`,
		// hf token vars the box provides, resolved exactly like the run does (interactive non-login +
		// login shells so a .bashrc-after-guard export is seen) plus the hf cli token file; one per line
		`(for _m in -ic -lic; do bash $_m 'for v in HF_TOKEN HF_API_KEY HUGGINGFACE_API_TOKEN HUGGING_FACE_HUB_TOKEN; do [ -n "$(printenv "$v" 2>/dev/null)" ] && echo "$v"; done' 2>/dev/null; done | sort -u; for tf in "\${HF_HOME:-$HOME/.cache/huggingface}/token" "$HOME/.huggingface/token"; do [ -r "$tf" ] && echo "HF_CLI_TOKEN" && break; done) 2>/dev/null`,
		`echo '@@PREP@@'`,
		`(cat "$HOME/.mylora/prepared.json" 2>/dev/null)`,
		`echo '@@UV@@'`,
		// is the uv wheel cache already warm (torch present) or a prep venv built? -> installs are fast
		`(c="\${UV_CACHE_DIR:-$HOME/.cache/uv}"; if { find "$c" -iname 'torch-*' 2>/dev/null | head -1 | grep -q .; } || ls -d "$HOME/.mylora/venv" >/dev/null 2>&1; then echo warm; else echo cold; fi) 2>/dev/null`,
		`echo '@@END@@'`
	].join('; ');
}

// the machine-level prepared dir: a persistent venv whose install warms uv's shared wheel cache so
// training-job venvs install instantly, plus a prepared.json marker recording what was installed
export const MACHINE_PREP_DIR = '$HOME/.mylora';

// detached script that prepares a machine's dependencies (writes prepared.json: preparing -> ready)
export function buildPrepareScript(opts: {
	doc2loraExtras: Doc2LoraExtras;
	load4bit: boolean;
	pythonVersion?: string | null;
}): string {
	const pyVersion = (opts.pythonVersion || '3.11').trim();
	const extras = opts.doc2loraExtras;
	const pkgs = enginePackages('doc2lora', opts.load4bit, extras).map(shq).join(' ');
	const marker = (status: 'preparing' | 'ready') =>
		`printf '{"status":"${status}","at":"%s","doc2loraExtras":"${extras}","load4bit":${opts.load4bit},"doc2loraVersion":"%s","torch":"%s","cuda":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$D2L" "$TORCH" "$CUDA" > "$PREP/prepared.json.tmp" && mv -f "$PREP/prepared.json.tmp" "$PREP/prepared.json"`;
	return `#!/usr/bin/env bash
set -uo pipefail
PREP="$HOME/.mylora"
mkdir -p "$PREP"
say() { printf '[%s] %s\\n' "$(date -u +%H:%M:%S)" "$*"; }
D2L=""; TORCH=""; CUDA=""
${marker('preparing')} 2>/dev/null || true
{
  set -e
  say "[prepare] preparing dependencies: doc2lora[${extras}] (python ${pyVersion})"
  if ! command -v uv >/dev/null 2>&1; then
    say "[prepare] bootstrapping uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  fi
  rm -rf "$PREP/venv"
  uv venv --python-preference only-managed --python ${shq(pyVersion)} "$PREP/venv"
  say "[prepare] installing (warms the uv wheel cache shared by all training jobs)"
  uv pip install --python "$PREP/venv/bin/python" ${pkgs}
  say "[prepare] detecting installed versions"
  D2L=$("$PREP/venv/bin/python" -c "import importlib.metadata as m; print(m.version('doc2lora'))" 2>/dev/null || echo "")
  TORCH=$("$PREP/venv/bin/python" -c "import torch; print(torch.__version__)" 2>/dev/null || echo "")
  CUDA=$("$PREP/venv/bin/python" -c "import torch; print(torch.version.cuda)" 2>/dev/null || echo "")
  ${marker('ready')}
  say "[prepare] done - doc2lora $D2L, torch $TORCH, cuda $CUDA"
} > "$PREP/prepare.log" 2>&1
`;
}

// launch the prepare script detached (all fds detached so the exec returns immediately)
export function buildPrepareLaunchCommand(): string {
	return `setsid nohup bash "$HOME/.mylora/prepare.sh" </dev/null >/dev/null 2>&1 & echo "$!"`;
}

export function buildAbortCommand(
	jobDir: string,
	pgid: number,
	opts?: { useSudo?: boolean; sudoPassword?: string | null }
): string {
	const d = shq(jobDir);
	const g = String(Math.trunc(pgid));
	// when the run was elevated its process group is root-owned, so the kill must be elevated too; we
	// reuse the ssh password as the sudo password when present, else fall back to passwordless sudo
	const killer = opts?.useSudo
		? opts.sudoPassword
			? `printf '%s\\n' ${shq(opts.sudoPassword)} | sudo -S -p '' -- `
			: 'sudo -n -- '
		: '';
	// kill the whole process group, then drop an aborted sentinel so a racing probe sees it
	return `${killer}kill -- -${g} 2>/dev/null; ${killer}kill ${g} 2>/dev/null; printf '{"status":"failed","exitCode":143}' > ${d}/done.json 2>/dev/null; true`;
}

export type ProbeSentinel =
	{ status: 'success'; sha256: string; size: number } | { status: 'failed'; exitCode: number };

export type ProbeParsed = {
	sentinel: ProbeSentinel | null;
	heartbeatEpoch: number | null;
	pidAlive: boolean;
	// cmdline of the probed pid, used for the pid-reuse guard
	cmdline: string;
	// last few KB of the remote train.log, surfaced live in the job log tail
	logTail: string;
	// live box telemetry sampled by the run script's heartbeat loop (null when not yet available)
	telemetry: JobTelemetry | null;
};

// parse the @@TEL@@ key=value block written by the run script's sampler
function parseTelemetry(raw: string): JobTelemetry | null {
	if (!raw.trim()) return null;
	const kv: Record<string, string> = {};
	for (const line of raw.split('\n')) {
		const i = line.indexOf('=');
		if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	const num = (s?: string) => {
		const n = Number(s);
		return s != null && s !== '' && Number.isFinite(n) ? n : null;
	};
	const t: JobTelemetry = {};
	t.cpuPct = num(kv.cpu);
	// gpu = "util, used, total"
	if (kv.gpu) {
		const g = kv.gpu.split(',').map((s) => s.trim());
		t.gpuUtilPct = num(g[0]);
		t.vramUsedMb = num(g[1]);
		t.vramTotalMb = num(g[2]);
	}
	// mem = "used,total" (MB)
	if (kv.mem) {
		const m = kv.mem.split(',');
		t.ramUsedMb = num(m[0]);
		t.ramTotalMb = num(m[1]);
	}
	if (kv.disk) t.diskAvailGb = num(kv.disk.replace(/G$/i, ''));
	// net = "rxBytes,txBytes" -> MB
	if (kv.net) {
		const [rx, tx] = kv.net.split(',');
		const rxN = num(rx);
		const txN = num(tx);
		t.netRxMb = rxN != null ? Math.round(rxN / 1048576) : null;
		t.netTxMb = txN != null ? Math.round(txN / 1048576) : null;
	}
	t.outputBytes = num(kv.out);
	return t;
}

function section(text: string, start: string, end: string): string {
	const i = text.indexOf(start);
	if (i < 0) return '';
	const from = i + start.length;
	const j = text.indexOf(end, from);
	return (j < 0 ? text.slice(from) : text.slice(from, j)).trim();
}

// parse buildProbeCommand stdout; jobDir is the wrapper-identity marker the cmdline must contain
export function parseProbeOutput(stdout: string, jobDir: string): ProbeParsed {
	const doneRaw = section(stdout, '@@DONE@@', '@@HB@@');
	const hbRaw = section(stdout, '@@HB@@', '@@PID@@');
	const pidRaw = section(stdout, '@@PID@@', '@@LOG@@');
	const logTail = redactSecrets(section(stdout, '@@LOG@@', '@@TEL@@'));
	const telemetry = parseTelemetry(section(stdout, '@@TEL@@', '@@END@@'));

	let sentinel: ProbeSentinel | null = null;
	if (doneRaw) {
		try {
			const j = JSON.parse(doneRaw);
			if (
				j &&
				j.status === 'success' &&
				typeof j.sha256 === 'string' &&
				typeof j.size === 'number'
			) {
				sentinel = { status: 'success', sha256: j.sha256, size: j.size };
			} else if (j && j.status === 'failed') {
				sentinel = { status: 'failed', exitCode: Number(j.exitCode ?? 1) };
			}
		} catch {
			// partial/garbled sentinel - treat as not-yet-present
		}
	}
	const hbNum = hbRaw ? Number(hbRaw.split(/\s+/)[0]) : NaN;
	// pid is "ours" only when its cmdline references this job's directory (reuse guard)
	const pidAlive = pidRaw.length > 0 && (pidRaw.includes(jobDir) || pidRaw === 'ALIVE');
	return {
		sentinel,
		heartbeatEpoch: Number.isFinite(hbNum) ? hbNum : null,
		pidAlive,
		cmdline: pidRaw,
		logTail,
		telemetry
	};
}

export type PreflightResult = {
	gpu: GpuInfo | null;
	pythonVersion: string | null;
	pythonOk: boolean;
	pipOk: boolean;
	sudo: boolean;
	system: SystemInfo;
};

export function parsePreflightOutput(stdout: string): PreflightResult {
	const gpuRaw = section(stdout, '@@GPU@@', '@@PY@@');
	const pyRaw = section(stdout, '@@PY@@', '@@PIP@@');
	const pipRaw = section(stdout, '@@PIP@@', '@@SUDO@@');
	const sudoRaw = section(stdout, '@@SUDO@@', '@@CPU@@');

	const numOrNull = (s: string) => {
		const n = Number(String(s).trim());
		return s != null && String(s).trim() !== '' && Number.isFinite(n) ? n : null;
	};

	// GPU section: one "name, total, used" line per gpu
	const gpus: GpuInfo[] = [];
	for (const line of gpuRaw
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)) {
		const parts = line.split(',').map((s) => s.trim());
		if (!parts[0]) continue;
		gpus.push({
			name: parts[0],
			vramMb: numOrNull(parts[1]!) ?? 0,
			vramUsedMb: numOrNull(parts[2] ?? '')
		});
	}
	const gpu = gpus[0] ?? null;

	// python >= 3.11 required
	const m = pyRaw.match(/Python\s+(\d+)\.(\d+)/i);
	const pythonOk = !!m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 11));

	const mem = section(stdout, '@@MEM@@', '@@DISK@@'); // "total,avail" MB
	const [ramTotal, ramAvail] = mem.split(',');
	const disk = section(stdout, '@@DISK@@', '@@ROTA@@'); // "totalG,availG"
	const [diskTotal, diskAvail] = disk.split(',');
	const rota = section(stdout, '@@ROTA@@', '@@OS@@').trim();

	// prepared.json marker (manually-prepared deps); tolerate absence/garble
	let prepared: SystemInfo['prepared'] = null;
	const prepRaw = section(stdout, '@@PREP@@', '@@UV@@');
	if (prepRaw) {
		try {
			const p = JSON.parse(prepRaw);
			if (p && (p.status === 'preparing' || p.status === 'ready')) prepared = p;
		} catch {
			// no/garbled marker -> not prepared
		}
	}

	// huggingface token env vars already present on the box (one name per line); used by the launch
	// modal to tell the user the box's own token will be used, so they need not paste one
	const hfTokenEnv = section(stdout, '@@HFENV@@', '@@PREP@@')
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);

	const system: SystemInfo = {
		hostname: section(stdout, '@@HOST@@', '@@HFENV@@') || null,
		os: section(stdout, '@@OS@@', '@@KERNEL@@') || null,
		kernel: section(stdout, '@@KERNEL@@', '@@USER@@') || null,
		user: section(stdout, '@@USER@@', '@@HOST@@') || null,
		cpuModel: section(stdout, '@@CPU@@', '@@CORES@@') || null,
		cpuCores: numOrNull(section(stdout, '@@CORES@@', '@@MEM@@')),
		ramTotalMb: ramTotal ? numOrNull(ramTotal) : null,
		ramAvailMb: ramAvail ? numOrNull(ramAvail) : null,
		diskTotalGb: diskTotal ? numOrNull(diskTotal.replace(/G$/i, '')) : null,
		diskAvailGb: diskAvail ? numOrNull(diskAvail.replace(/G$/i, '')) : null,
		diskType: rota === '0' ? 'SSD' : rota === '1' ? 'HDD' : null,
		gpus,
		prepared,
		hfTokenEnv: hfTokenEnv.length ? hfTokenEnv : null,
		// uv wheel cache already warm (or a prep venv exists) -> deps install in seconds even unprepared
		depsCached: /warm/.test(section(stdout, '@@UV@@', '@@END@@')) ? true : false
	};

	return {
		gpu,
		pythonVersion: m ? `${m[1]}.${m[2]}` : null,
		pythonOk,
		pipOk: !!pipRaw && !/MISSING/.test(pipRaw),
		sudo: /YES/.test(sudoRaw),
		system
	};
}

// approximate VRAM (MB) to train a model class full-precision vs 4-bit (QLoRA), per the doc2lora
// README GPU guidance (7B ~16GB full / fits in 12GB with QLoRA; 32B needs QLoRA; etc.)
export function vramNeeds(baseModel: string): { full: number; fourBit: number } {
	const m = (baseModel || '').toLowerCase();
	const full = /32b/.test(m) ? 40000 : /11b/.test(m) ? 24000 : /[^0-9]2b/.test(m) ? 8000 : 16000;
	const fourBit = /32b/.test(m) ? 20000 : /11b/.test(m) ? 12000 : /[^0-9]2b/.test(m) ? 5000 : 8000;
	return { full, fourBit };
}

export function vramAdequate(baseModel: string, vramMb: number, load4bit: boolean): boolean {
	const n = vramNeeds(baseModel);
	return vramMb >= (load4bit ? n.fourBit : n.full);
}

export type TuneResult = {
	config: RemoteTrainingConfig;
	adjustments: string[];
	feasible: boolean;
	reason?: string;
};

export function tuneConfigForVram(config: RemoteTrainingConfig, vramMb: number): TuneResult {
	const adjustments: string[] = [];
	const next: RemoteTrainingConfig = { ...config };
	if (config.device === 'cpu') return { config: next, adjustments, feasible: true };

	const n = vramNeeds(config.baseModel);
	if (vramMb >= n.full) return { config: next, adjustments, feasible: true };

	if (vramMb >= n.fourBit) {
		if (!next.load4bit) {
			next.load4bit = true;
			adjustments.push(`Enabled 4-bit (QLoRA) to fit ${vramMb}MB of VRAM`);
		}
		if (next.batchSize > 1) {
			const ga = next.gradientAccumulationSteps * next.batchSize;
			adjustments.push(
				`Reduced batch size ${next.batchSize} -> 1 (gradient accumulation ${next.gradientAccumulationSteps} -> ${ga}) to fit VRAM`
			);
			next.gradientAccumulationSteps = ga;
			next.batchSize = 1;
		}
		return { config: next, adjustments, feasible: true };
	}

	return {
		config: next,
		adjustments,
		feasible: false,
		reason: `needs at least ${n.fourBit}MB even with 4-bit (QLoRA) for this model size, but only ${vramMb}MB is available`
	};
}

// scrub secrets from box-originated text before it is persisted/shown
const SECRET_PATTERNS: { re: RegExp; keepTail: boolean }[] = [
	{ re: /\bhf_[A-Za-z0-9]{8,}/g, keepTail: true }, // huggingface token
	{ re: /\bsk-[A-Za-z0-9_-]{16,}/g, keepTail: true }, // openai
	{ re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, keepTail: true }, // github pat
	{ re: /\bAKIA[0-9A-Z]{16}\b/g, keepTail: true }, // aws key id
	{ re: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, keepTail: false },
	{
		re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token)\b\s*["']?\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{8,}=*)/gi,
		keepTail: false
	}
];

export function redactSecrets(text: string): string {
	if (!text) return text;
	let out = text;
	for (const { re, keepTail } of SECRET_PATTERNS) {
		out = out.replace(re, (match, captured) => {
			if (keepTail) return `***REDACTED:${match.slice(-4)}***`;
			// keep the leading label, mask only the value
			if (captured) return match.slice(0, match.length - captured.length) + '***REDACTED***';
			return '***REDACTED***';
		});
	}
	return out;
}

// classify a reported failure; a HuggingFace gated/401 (only shows as "exit code 1") becomes an
// actionable 'gated' failure with the repo + license link, everything else stays 'reported'
export type TrainingFailure = { failureClass: 'reported' | 'gated'; message: string };

export function classifyTrainingFailure(log: string, exitCode: number): TrainingFailure {
	const text = log || '';
	// pull the gated repo id out of the canonical HF error strings
	const repo =
		text.match(/Access to (?:model|dataset)\s+([\w./-]+?)\s+is restricted/i)?.[1] ??
		text.match(/huggingface\.co\/([\w-]+\/[\w.-]+?)(?:\/resolve|\/blob|\/tree|["'\s)]|$)/i)?.[1] ??
		text.match(/gated (?:repo|model)[^\n]*?\b([\w-]+\/[\w.-]+)\b/i)?.[1] ??
		null;

	const gatedSig =
		/\bgated repo\b/i.test(text) ||
		/you are trying to access a gated repo/i.test(text) ||
		/Access to (?:model|dataset)\s+[\w./-]+\s+is restricted/i.test(text) ||
		/is restricted\.?\s*you must/i.test(text) ||
		/must have access to it and be authenticated/i.test(text) ||
		// a 401 with nearby hub/auth context (so unrelated 401s don't match)
		(/\b401\b/.test(text) &&
			/huggingface|gated|restricted|authenticated|repository not found/i.test(text));

	if (gatedSig) {
		const link = repo ? `https://huggingface.co/${repo}` : 'https://huggingface.co';
		const which = repo ? `"${repo}"` : 'the base model';
		return {
			failureClass: 'gated',
			message: `HuggingFace denied access to ${which} - it is gated (HTTP 401). Accept its license at ${link} and supply a token with access, then retry.`
		};
	}
	return {
		failureClass: 'reported',
		message: `Training reported failure (exit code ${exitCode}).`
	};
}

// build the dataset.jsonl line set for the peft engine from a plain text/jsonl upload
export function normalizeDatasetJsonl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	// already jsonl with {text:...} objects -> pass through valid lines
	const lines = trimmed.split('\n');
	const looksJsonl = lines.every((l) => {
		const t = l.trim();
		if (!t) return true;
		try {
			const o = JSON.parse(t);
			return o && typeof o === 'object';
		} catch {
			return false;
		}
	});
	if (looksJsonl) {
		return lines
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const o = JSON.parse(l);
				return JSON.stringify({ text: typeof o.text === 'string' ? o.text : JSON.stringify(o) });
			})
			.join('\n');
	}
	// plain text -> one example
	return JSON.stringify({ text: trimmed });
}
