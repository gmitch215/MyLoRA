import { describe, expect, it } from 'vitest';
import {
	buildDoc2loraArgs,
	buildLaunchCommand,
	buildPeftArgs,
	buildPreflightCommand,
	buildProbeCommand,
	buildRunScript,
	classifyTrainingFailure,
	normalizeDatasetJsonl,
	parsePreflightOutput,
	parseProbeOutput,
	redactSecrets,
	shq,
	TRAIN_PEFT_PY,
	vramAdequate,
	type RemoteTrainingConfig
} from '../../src/server/utils/remote-commands';

// a baseline well-formed config; individual tests override fields they care about
function cfg(over: Partial<RemoteTrainingConfig> = {}): RemoteTrainingConfig {
	return {
		baseModel: '@cf/meta/llama-3.1-8b-instruct',
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

describe('shq', () => {
	it('wraps a plain token in single quotes', () => {
		expect(shq('hello')).toBe(`'hello'`);
	});

	it('escapes embedded single quotes with the close-escape-reopen idiom', () => {
		expect(shq("a'b")).toBe(`'a'\\''b'`);
	});

	it('quotes shell metacharacters so they cannot break out', () => {
		const q = shq('; rm -rf /');
		expect(q).toBe(`'; rm -rf /'`);
		// no unescaped quote can terminate it early
		expect(q.startsWith(`'`)).toBe(true);
		expect(q.endsWith(`'`)).toBe(true);
	});

	it('coerces non-strings via String()', () => {
		expect(shq(42 as unknown as string)).toBe(`'42'`);
	});
});

describe('buildDoc2loraArgs', () => {
	it('emits the expected flag sequence from a config', () => {
		const args = buildDoc2loraArgs('/tmp/mylora-jobs/job1', cfg());
		expect(args[0]).toBe('/tmp/mylora-jobs/job1/venv/bin/doc2lora');
		expect(args).toContain('convert');
		expect(args).toContain('--model');
		expect(args[args.indexOf('--model') + 1]).toBe('@cf/meta/llama-3.1-8b-instruct');
		expect(args[args.indexOf('--lora-r') + 1]).toBe('8');
		expect(args[args.indexOf('--device') + 1]).toBe('cuda');
		// no 4bit flag unless requested
		expect(args).not.toContain('--load-in-4bit');
	});

	it('appends --load-in-4bit when load4bit is set', () => {
		const args = buildDoc2loraArgs('/tmp/mylora-jobs/job1', cfg({ load4bit: true }));
		expect(args).toContain('--load-in-4bit');
	});
});

describe('buildPeftArgs', () => {
	it('emits base-model + job-dir + numeric flags', () => {
		const args = buildPeftArgs('/tmp/mylora-jobs/jobP', cfg());
		expect(args[0]).toBe('/tmp/mylora-jobs/jobP/venv/bin/python');
		expect(args[1]).toBe('/tmp/mylora-jobs/jobP/train_peft.py');
		expect(args[args.indexOf('--base-model') + 1]).toBe('@cf/meta/llama-3.1-8b-instruct');
		expect(args[args.indexOf('--grad-accum') + 1]).toBe('1');
		expect(args[args.indexOf('--target-modules') + 1]).toBe('q_proj,v_proj');
	});

	it('omits --target-modules when none are provided', () => {
		const args = buildPeftArgs('/tmp/mylora-jobs/jobP', cfg({ targetModules: [] }));
		expect(args).not.toContain('--target-modules');
	});

	it('passes the huggingface dataset source flags from the config', () => {
		const args = buildPeftArgs(
			'/tmp/mylora-jobs/jobP',
			cfg({
				hfDataset: 'databricks/databricks-dolly-15k',
				hfConfig: 'main',
				hfSplit: 'validation',
				textField: 'response',
				textTemplate: '### Q: {instruction}\n### A: {response}'
			})
		);
		expect(args[args.indexOf('--hf-dataset') + 1]).toBe('databricks/databricks-dolly-15k');
		expect(args[args.indexOf('--hf-config') + 1]).toBe('main');
		expect(args[args.indexOf('--hf-split') + 1]).toBe('validation');
		expect(args[args.indexOf('--text-field') + 1]).toBe('response');
		expect(args[args.indexOf('--text-template') + 1]).toBe(
			'### Q: {instruction}\n### A: {response}'
		);
	});

	it('defaults hf-split to train and leaves the optional text fields empty', () => {
		const args = buildPeftArgs('/tmp/mylora-jobs/jobP', cfg({ hfDataset: 'foo/bar' }));
		expect(args[args.indexOf('--hf-split') + 1]).toBe('train');
		expect(args[args.indexOf('--text-field') + 1]).toBe('');
		expect(args[args.indexOf('--text-template') + 1]).toBe('');
		expect(args[args.indexOf('--hf-config') + 1]).toBe('');
	});

	it('appends --load-in-4bit only when load4bit is set', () => {
		expect(buildPeftArgs('/tmp/mylora-jobs/jobP', cfg())).not.toContain('--load-in-4bit');
		expect(buildPeftArgs('/tmp/mylora-jobs/jobP', cfg({ load4bit: true }))).toContain(
			'--load-in-4bit'
		);
	});

	it('keeps a shell-injecting textTemplate as a single shq token in the run script', () => {
		// a template that tries to break out of its single-quoted argv slot
		const evil = `{x}'; rm -rf /`;
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jt',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar', textTemplate: evil })
		});
		// the template only ever appears inside its shq-quoted token, never raw
		expect(script).toContain(shq(evil));
		const lines = script.split('\n');
		for (const line of lines) {
			if (line.includes(evil)) expect(line).toContain(shq(evil));
		}
		// the dangerous command must never become its own statement
		expect(script).not.toMatch(/\n\s*rm -rf \/\s*\n/);
	});
});

describe('TRAIN_PEFT_PY', () => {
	it('loads its dataset from huggingface and trains a causal-lm peft adapter', () => {
		expect(TRAIN_PEFT_PY).toContain('load_dataset(');
		expect(TRAIN_PEFT_PY).toContain('AutoModelForCausalLM');
		expect(TRAIN_PEFT_PY).toContain("task_type='CAUSAL_LM'");
		expect(TRAIN_PEFT_PY).toContain('save_pretrained');
	});

	it('has a to_text/text-template path for building each training example', () => {
		expect(TRAIN_PEFT_PY).toContain('def to_text');
		expect(TRAIN_PEFT_PY).toContain('a.text_template');
		expect(TRAIN_PEFT_PY).toContain('a.text_field');
	});

	it('never references a local jsonl upload path (it loads from HF, not an uploaded file)', () => {
		expect(TRAIN_PEFT_PY).not.toContain('dataset.jsonl');
		expect(TRAIN_PEFT_PY).not.toContain('/input');
	});
});

describe('buildRunScript', () => {
	it('bootstraps a venv and writes the sentinel via atomic rename', () => {
		const script = buildRunScript({ jobDir: '/tmp/mylora-jobs/jr', engine: 'peft', config: cfg() });
		// robust venv: prefers uv, falls back to the stdlib venv module
		expect(script).toContain('uv venv');
		expect(script).toContain('python3 -m venv');
		// installs land in the job venv's pip
		expect(script).toContain(shq('/tmp/mylora-jobs/jr/venv/bin/pip'));
		// done.json written to a tmp file then atomically renamed
		expect(script).toContain('done.json.tmp');
		expect(script).toContain('mv -f "$JOB_DIR/done.json.tmp" "$JOB_DIR/done.json"');
		// the shq'd train command is present
		expect(script).toContain(shq('/tmp/mylora-jobs/jr/venv/bin/python'));
		// the launcher pieces belong to buildLaunchCommand, not the run script
		expect(script).not.toContain('setsid');
	});

	it('useVenv true (default) bootstraps a venv and never breaks system packages', () => {
		const script = buildRunScript({ jobDir: '/tmp/mylora-jobs/jr', engine: 'peft', config: cfg() });
		expect(script).toContain('uv venv');
		expect(script).not.toContain('--break-system-packages');
		// installs go through the venv pip, not a bare system python
		expect(script).toContain(shq('/tmp/mylora-jobs/jr/venv/bin/pip'));
	});

	it('useVenv false installs into the system python with --break-system-packages and no venv', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ useVenv: false })
		});
		expect(script).toContain('--break-system-packages');
		// no isolated venv is created
		expect(script).not.toContain('uv venv');
		expect(script).not.toContain('python3 -m venv');
		// the train command runs under the system python, not the venv binary
		expect(script).not.toContain('/venv/bin/python');
		expect(script).toContain(shq('python3'));
	});

	it('keeps a malicious baseModel as a single shq-quoted token (injection-safe)', () => {
		const evil = '"; rm -rf /';
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jx',
			engine: 'peft',
			config: cfg({ baseModel: evil })
		});
		// the only place the evil string can appear is inside its single-quoted token
		expect(script).toContain(shq(evil));
		// it must never appear unquoted (which would be the raw injection)
		const lines = script.split('\n');
		for (const line of lines) {
			const idx = line.indexOf(evil);
			if (idx < 0) continue;
			// the occurrence must be bracketed by the shq quoting, never raw
			expect(line).toContain(shq(evil));
		}
		// the dangerous command must never become its own statement
		expect(script).not.toMatch(/\n\s*rm -rf \/\s*\n/);
	});

	it('adds bitsandbytes install only when 4bit is on', () => {
		const off = buildRunScript({ jobDir: '/tmp/mylora-jobs/j', engine: 'peft', config: cfg() });
		const on = buildRunScript({
			jobDir: '/tmp/mylora-jobs/j',
			engine: 'peft',
			config: cfg({ load4bit: true })
		});
		expect(off).not.toContain('bitsandbytes');
		expect(on).toContain('bitsandbytes');
	});

	it('always cross-populates the huggingface token across the three env names', () => {
		const script = buildRunScript({ jobDir: '/tmp/mylora-jobs/jr', engine: 'peft', config: cfg() });
		// the normalize line mirrors whichever name the box already has onto all three
		expect(script).toContain('HF_TOKEN:-${HF_API_KEY');
		expect(script).toContain('HUGGINGFACE_API_TOKEN');
	});

	it('injects a per-job hfToken as a shq export BEFORE the normalize line', () => {
		const token = 'hf_secretToken123';
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' }),
			hfToken: token
		});
		// the token is exported, shq-quoted (never raw)
		expect(script).toContain(`export HF_TOKEN=${shq(token)}`);
		// and that export precedes the cross-populate normalize line so it wins
		const exportIdx = script.indexOf(`export HF_TOKEN=${shq(token)}`);
		const normalizeIdx = script.indexOf('HF_TOKEN:-${HF_API_KEY');
		expect(exportIdx).toBeGreaterThanOrEqual(0);
		expect(exportIdx).toBeLessThan(normalizeIdx);
	});

	it('does not inject any literal token export when no hfToken is provided', () => {
		const script = buildRunScript({ jobDir: '/tmp/mylora-jobs/jr', engine: 'peft', config: cfg() });
		// only the parameter-expansion normalize assignment may set HF_TOKEN, never a bare literal export
		expect(script).not.toMatch(/export HF_TOKEN='[^']/);
	});

	it('keeps a shell-injecting hfToken as a single shq token', () => {
		const evil = `x'; rm -rf /`;
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg(),
			hfToken: evil
		});
		expect(script).toContain(`export HF_TOKEN=${shq(evil)}`);
		expect(script).not.toMatch(/\n\s*rm -rf \/\s*\n/);
	});

	it('doc2lora run script keeps the venv bootstrap + atomic done.json rename', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jd',
			engine: 'doc2lora',
			config: cfg()
		});
		expect(script).toContain('python3 -m venv');
		expect(script).toContain('done.json.tmp');
		expect(script).toContain('mv -f "$JOB_DIR/done.json.tmp" "$JOB_DIR/done.json"');
		// it drives the doc2lora cli, not the peft python script
		expect(script).toContain(shq('/tmp/mylora-jobs/jd/venv/bin/doc2lora'));
		expect(script).not.toContain('train_peft.py');
		expect(script).not.toContain('setsid');
	});

	it('peft run script drives the generated python script, not the doc2lora cli', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jp',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		expect(script).toContain(shq('/tmp/mylora-jobs/jp/train_peft.py'));
		expect(script).not.toContain('/venv/bin/doc2lora');
	});
});

describe('buildLaunchCommand', () => {
	it('detaches via setsid nohup and echoes the child pid', () => {
		const cmd = buildLaunchCommand('/tmp/mylora-jobs/jl');
		expect(cmd).toContain('setsid nohup');
		expect(cmd).toContain('bash');
		expect(cmd).toContain(shq('/tmp/mylora-jobs/jl') + '/run.sh');
		expect(cmd).toContain('echo "$!"');
	});
});

describe('parseProbeOutput', () => {
	const jobDir = '/tmp/mylora-jobs/abc';

	function probe(done: string, hb: string, pid: string, log = '', tel = ''): string {
		return `@@DONE@@\n${done}\n@@HB@@\n${hb}\n@@PID@@\n${pid}\n@@LOG@@\n${log}\n@@TEL@@\n${tel}\n@@END@@\n`;
	}

	it('parses a success sentinel', () => {
		const out = probe('{"status":"success","sha256":"deadbeef","size":1234}', '1700000000', '');
		const r = parseProbeOutput(out, jobDir);
		expect(r.sentinel).toEqual({ status: 'success', sha256: 'deadbeef', size: 1234 });
		expect(r.heartbeatEpoch).toBe(1700000000);
		expect(r.pidAlive).toBe(false);
	});

	it('parses a failed sentinel', () => {
		const out = probe('{"status":"failed","exitCode":7}', '1700000000', '');
		const r = parseProbeOutput(out, jobDir);
		expect(r.sentinel).toEqual({ status: 'failed', exitCode: 7 });
	});

	it('treats no sentinel + cmdline containing jobDir as running (pidAlive true)', () => {
		const out = probe('', '1700000000', `python ${jobDir}/train_peft.py --base-model x`);
		const r = parseProbeOutput(out, jobDir);
		expect(r.sentinel).toBeNull();
		expect(r.pidAlive).toBe(true);
		expect(r.cmdline).toContain(jobDir);
	});

	it('extracts the train.log tail and keeps the pid section separate from it', () => {
		const out = probe('', '1700000000', `python ${jobDir}/train_peft.py`, 'step 10 loss 0.5');
		const r = parseProbeOutput(out, jobDir);
		expect(r.logTail).toBe('step 10 loss 0.5');
		// the log content must not bleed into the pid/cmdline section (reuse guard integrity)
		expect(r.cmdline).not.toContain('loss');
		expect(r.pidAlive).toBe(true);
	});

	it('adds a tail of train.log to the probe command', () => {
		expect(buildProbeCommand(jobDir, 4242)).toContain('train.log');
	});

	it('treats an empty pid section as dead (pidAlive false)', () => {
		const out = probe('', '', '');
		const r = parseProbeOutput(out, jobDir);
		expect(r.sentinel).toBeNull();
		expect(r.heartbeatEpoch).toBeNull();
		expect(r.pidAlive).toBe(false);
	});

	it('does not trust a pid whose cmdline belongs to another job (reuse guard)', () => {
		const out = probe('', '1700000000', 'python /tmp/mylora-jobs/OTHER/train_peft.py');
		const r = parseProbeOutput(out, jobDir);
		expect(r.pidAlive).toBe(false);
	});

	it('ignores a garbled sentinel rather than throwing', () => {
		const out = probe('{not json', '1700000000', '');
		const r = parseProbeOutput(out, jobDir);
		expect(r.sentinel).toBeNull();
	});
});

describe('parsePreflightOutput', () => {
	function pre(gpu: string, py: string, pip: string, sudo: string): string {
		return `@@GPU@@\n${gpu}\n@@PY@@\n${py}\n@@PIP@@\n${pip}\n@@SUDO@@\n${sudo}\n@@END@@\n`;
	}

	it('parses gpu name + vram (total + used), python ok, pip ok, sudo yes', () => {
		const out = pre('NVIDIA RTX 4090, 24576, 1024', 'Python 3.11.6', 'pip 24.0 from ...', 'YES');
		const r = parsePreflightOutput(out);
		expect(r.gpu).toEqual({ name: 'NVIDIA RTX 4090', vramMb: 24576, vramUsedMb: 1024 });
		expect(r.pythonOk).toBe(true);
		expect(r.pythonVersion).toBe('3.11');
		expect(r.pipOk).toBe(true);
		expect(r.sudo).toBe(true);
	});

	it('flags python 3.10 as not ok (3.11+ required)', () => {
		const out = pre('', 'Python 3.10.12', 'pip 24.0', 'NO');
		const r = parsePreflightOutput(out);
		expect(r.pythonOk).toBe(false);
		expect(r.gpu).toBeNull();
		expect(r.sudo).toBe(false);
	});

	it('flags missing pip', () => {
		const out = pre('', 'Python 3.12.1', 'MISSING', 'NO');
		const r = parsePreflightOutput(out);
		expect(r.pythonOk).toBe(true);
		expect(r.pipOk).toBe(false);
	});

	// a richer stdout that carries the trailing marker chain ...@@HOST@@,@@HFENV@@,@@PREP@@,@@UV@@
	function preFull(over: { host?: string; hfenv?: string; uv?: string } = {}): string {
		const host = over.host ?? 'gpu-box-01';
		const hfenv = over.hfenv ?? '';
		const uv = over.uv ?? '';
		return [
			`@@GPU@@\nNVIDIA RTX 4090, 24576, 1024`,
			`@@PY@@\nPython 3.11.6`,
			`@@PIP@@\npip 24.0`,
			`@@SUDO@@\nYES`,
			`@@CPU@@\nMock CPU`,
			`@@CORES@@\n16`,
			`@@MEM@@\n64000,48000`,
			`@@DISK@@\n500,320`,
			`@@ROTA@@\n0`,
			`@@OS@@\nUbuntu 24.04.1 LTS`,
			`@@KERNEL@@\n6.8.0`,
			`@@USER@@\ntrainer`,
			`@@HOST@@\n${host}`,
			`@@HFENV@@\n${hfenv}`,
			`@@PREP@@\n`,
			`@@UV@@\n${uv}`,
			`@@END@@\n`
		].join('\n');
	}

	it('parses the @@HFENV@@ block into system.hfTokenEnv and keeps @@HOST@@ hostname intact', () => {
		const r = parsePreflightOutput(preFull({ host: 'gpu-box-01', hfenv: 'HF_API_KEY' }));
		expect(r.system.hfTokenEnv).toEqual(['HF_API_KEY']);
		// @@HOST@@..@@HFENV@@ still resolves now that @@HFENV@@ sits between @@HOST@@ and @@PREP@@
		expect(r.system.hostname).toBe('gpu-box-01');
	});

	it('parses multiple @@HFENV@@ var names (one per line)', () => {
		const r = parsePreflightOutput(preFull({ hfenv: 'HF_TOKEN\nHUGGINGFACE_API_TOKEN' }));
		expect(r.system.hfTokenEnv).toEqual(['HF_TOKEN', 'HUGGINGFACE_API_TOKEN']);
	});

	it('yields hfTokenEnv null when the @@HFENV@@ block is empty', () => {
		const r = parsePreflightOutput(preFull({ hfenv: '' }));
		expect(r.system.hfTokenEnv).toBeNull();
		// an empty hfenv must not swallow the hostname that follows it
		expect(r.system.hostname).toBe('gpu-box-01');
	});

	it('tolerates a missing @@HFENV@@ section (legacy stdout) with hfTokenEnv null', () => {
		// the bare 4-marker helper omits @@HOST@@/@@HFENV@@ entirely; the parser must not throw
		const out = pre('', 'Python 3.12.1', 'pip 24.0', 'NO');
		const r = parsePreflightOutput(out);
		expect(r.system.hfTokenEnv).toBeNull();
		expect(r.system.hostname).toBeNull();
	});

	it('reads @@UV@@ "warm" into system.depsCached (and the hostname survives)', () => {
		const r = parsePreflightOutput(preFull({ uv: 'warm' }));
		expect(r.system.depsCached).toBe(true);
		expect(r.system.hostname).toBe('gpu-box-01');
	});

	it('depsCached is false for a "cold" or absent @@UV@@ block', () => {
		expect(parsePreflightOutput(preFull({ uv: 'cold' })).system.depsCached).toBe(false);
		expect(parsePreflightOutput(pre('', 'Python 3.12.1', 'pip 24.0', 'NO')).system.depsCached).toBe(
			false
		);
	});
});

describe('buildPreflightCommand', () => {
	it('emits the @@HFENV@@ marker between @@HOST@@ and @@PREP@@', () => {
		const cmd = buildPreflightCommand();
		expect(cmd).toContain(`echo '@@HFENV@@'`);
		// marker order: ...@@USER@@ , @@HOST@@ , @@HFENV@@ , @@PREP@@ , @@UV@@ , @@END@@
		expect(cmd.indexOf('@@HOST@@')).toBeLessThan(cmd.indexOf('@@HFENV@@'));
		expect(cmd.indexOf('@@HFENV@@')).toBeLessThan(cmd.indexOf('@@PREP@@'));
		expect(cmd.indexOf('@@PREP@@')).toBeLessThan(cmd.indexOf('@@UV@@'));
		// it probes the four token env names doc2lora + peft read
		expect(cmd).toContain('HF_TOKEN');
		expect(cmd).toContain('HF_API_KEY');
		expect(cmd).toContain('HUGGINGFACE_API_TOKEN');
		expect(cmd).toContain('HUGGING_FACE_HUB_TOKEN');
	});

	it('probes the uv wheel cache (torch) for the @@UV@@ warm/cold signal', () => {
		const cmd = buildPreflightCommand();
		expect(cmd).toContain(`echo '@@UV@@'`);
		expect(cmd).toContain('torch-*');
	});
});

describe('classifyTrainingFailure', () => {
	// the canonical HF gated/401 stderr (matches the mock-gated scenario in remote.ts)
	const GATED_LOG = `Traceback (most recent call last):
huggingface_hub.errors.GatedRepoError: 401 Client Error. Cannot access gated repo for url https://huggingface.co/meta-llama/Llama-2-7b-chat-hf/resolve/main/config.json.
Access to model meta-llama/Llama-2-7b-chat-hf is restricted. You must have access to it and be authenticated to access it. Please log in.`;

	it('classifies the canonical HF gated 401 stderr as gated with the repo link', () => {
		const r = classifyTrainingFailure(GATED_LOG, 1);
		expect(r.failureClass).toBe('gated');
		expect(r.message).toContain('huggingface.co/meta-llama/Llama-2-7b-chat-hf');
		expect(r.message.toLowerCase()).toContain('gated');
	});

	it('detects the "you are trying to access a gated repo" signature', () => {
		const r = classifyTrainingFailure('You are trying to access a gated repo.', 1);
		expect(r.failureClass).toBe('gated');
	});

	it('detects "must have access to it and be authenticated"', () => {
		const r = classifyTrainingFailure('you must have access to it and be authenticated', 1);
		expect(r.failureClass).toBe('gated');
	});

	it('extracts the repo from an "Access to model X is restricted" line', () => {
		const r = classifyTrainingFailure('Access to model org/some-model is restricted.', 1);
		expect(r.failureClass).toBe('gated');
		expect(r.message).toContain('huggingface.co/org/some-model');
	});

	it('treats a bare 401 with hub/auth context as gated', () => {
		const r = classifyTrainingFailure('401 Unauthorized from huggingface authenticated request', 1);
		expect(r.failureClass).toBe('gated');
	});

	it('does NOT treat an unrelated 401 (no hub context) as gated', () => {
		const r = classifyTrainingFailure('my-service returned 401 talking to the billing api', 1);
		expect(r.failureClass).toBe('reported');
	});

	it('classifies a plain python ValueError as reported with the exit code', () => {
		const log = `Traceback (most recent call last):\n  File "train.py", line 10\nValueError: bad config`;
		const r = classifyTrainingFailure(log, 1);
		expect(r.failureClass).toBe('reported');
		expect(r.message).toBe('Training reported failure (exit code 1).');
	});

	it('reports the actual exit code in the reported message', () => {
		const r = classifyTrainingFailure('segfault, no gated text here', 137);
		expect(r.failureClass).toBe('reported');
		expect(r.message).toContain('exit code 137');
	});

	it('falls back to the generic base-model link when no repo id is present', () => {
		const r = classifyTrainingFailure('You are trying to access a gated repo', 1);
		expect(r.message).toContain('the base model');
		expect(r.message).toContain('https://huggingface.co');
	});
});

describe('redactSecrets', () => {
	it('masks a huggingface token to a 4-char tail and preserves surrounding words', () => {
		const out = redactSecrets('using token hf_abcdEFGH12345678wxyz now to login');
		expect(out).not.toContain('hf_abcdEFGH12345678wxyz');
		expect(out).toContain('***REDACTED:wxyz***');
		// non-secret words survive untouched
		expect(out).toContain('using token');
		expect(out).toContain('to login');
	});

	it('masks openai sk-, github ghp_/gho_, and aws AKIA keys', () => {
		expect(redactSecrets('sk-abcdEFGH12345678ZZZZ')).toContain('***REDACTED:');
		expect(redactSecrets('ghp_abcdEFGH12345678wxyz')).toContain('***REDACTED:');
		expect(redactSecrets('gho_abcdEFGH12345678wxyz')).toContain('***REDACTED:');
		expect(redactSecrets('AKIAABCDEFGHIJKLMNOP')).toContain('***REDACTED:');
	});

	it('masks a Bearer token value to a label-less mask (no tail)', () => {
		const out = redactSecrets('header value Bearer abcDEF123456ghiJKL trailing');
		expect(out).not.toContain('abcDEF123456ghiJKL');
		expect(out).toContain('***REDACTED***');
		// the surrounding (non-secret) words are preserved
		expect(out).toContain('header value');
		expect(out).toContain('trailing');
	});

	it('masks labeled key=value / "key":"value" secrets while keeping the label', () => {
		const eq = redactSecrets('api_key=supersecretvalue123');
		expect(eq).not.toContain('supersecretvalue123');
		expect(eq).toContain('api_key=***REDACTED***');
		const json = redactSecrets('"password":"hunter2hunter2"');
		expect(json).not.toContain('hunter2hunter2');
		expect(json).toContain('***REDACTED***');
	});

	it('leaves non-secret text completely intact', () => {
		const text = 'training loss 0.5 at step 100 on cuda';
		expect(redactSecrets(text)).toBe(text);
	});
});

describe('vramAdequate', () => {
	it('7b/8b needs 16000 full, 8000 in 4bit', () => {
		const m = '@cf/meta/llama-3.1-8b-instruct';
		expect(vramAdequate(m, 16000, false)).toBe(true);
		expect(vramAdequate(m, 15999, false)).toBe(false);
		expect(vramAdequate(m, 8000, true)).toBe(true);
		expect(vramAdequate(m, 7999, true)).toBe(false);
	});

	it('32b needs 40000 full, 20000 in 4bit', () => {
		const m = 'qwen2.5-32b';
		expect(vramAdequate(m, 40000, false)).toBe(true);
		expect(vramAdequate(m, 39999, false)).toBe(false);
		expect(vramAdequate(m, 20000, true)).toBe(true);
		expect(vramAdequate(m, 19999, true)).toBe(false);
	});
});

describe('normalizeDatasetJsonl', () => {
	it('wraps plain text in a single {text} line', () => {
		expect(normalizeDatasetJsonl('hello world')).toBe(JSON.stringify({ text: 'hello world' }));
	});

	it('passes through valid jsonl {text} objects', () => {
		const input = `{"text":"a"}\n{"text":"b"}`;
		expect(normalizeDatasetJsonl(input)).toBe(`{"text":"a"}\n{"text":"b"}`);
	});

	it('returns empty for empty input', () => {
		expect(normalizeDatasetJsonl('   ')).toBe('');
	});

	it('serializes a non-text json object into the text field', () => {
		const out = normalizeDatasetJsonl('{"foo":"bar"}');
		const parsed = JSON.parse(out);
		expect(typeof parsed.text).toBe('string');
		expect(parsed.text).toContain('foo');
	});
});
