import { describe, expect, it } from 'vitest';
import {
	buildAbortCommand,
	buildLaunchCommand,
	buildRunScript,
	doc2loraPipSpec,
	enginePackages,
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

describe('doc2lora parser scope (extras)', () => {
	it('maps the scope to the right pip extra', () => {
		expect(doc2loraPipSpec('core')).toContain('doc2lora @ git+');
		expect(doc2loraPipSpec('core')).not.toContain('[');
		expect(doc2loraPipSpec('docs')).toContain('doc2lora[docs] @ git+');
		expect(doc2loraPipSpec('all')).toContain('doc2lora[all] @ git+');
		// default is docs
		expect(doc2loraPipSpec()).toContain('doc2lora[docs] @ git+');
	});
	it('enginePackages threads the scope for doc2lora only', () => {
		expect(enginePackages('doc2lora', false, 'all')[0]).toContain('doc2lora[all] @');
		expect(enginePackages('doc2lora', false, 'core')[0]).toContain('doc2lora @ git+');
		// 4-bit appends bitsandbytes regardless of scope
		expect(enginePackages('doc2lora', true, 'docs')).toContain('bitsandbytes');
		// peft ignores the scope and never installs doc2lora
		expect(enginePackages('peft', false, 'all').join(' ')).not.toContain('doc2lora');
	});
	it('the run script installs the chosen scope', () => {
		const all = buildRunScript({
			jobDir: '/tmp/x',
			engine: 'doc2lora',
			config: cfg({ doc2loraExtras: 'all' })
		});
		expect(all).toContain('doc2lora[all] @');
		const core = buildRunScript({
			jobDir: '/tmp/x',
			engine: 'doc2lora',
			config: cfg({ doc2loraExtras: 'core' })
		});
		expect(core).toContain('doc2lora @ git+');
		expect(core).not.toContain('doc2lora[');
	});
});

describe('attempt banner', () => {
	it('stamps the 1-based attempt number into the captured log block', () => {
		const s = buildRunScript({ jobDir: '/tmp/x', engine: 'doc2lora', config: cfg(), attempt: 3 });
		expect(s).toContain('say "===== Attempt #3 - doc2lora ====="');
		// default attempt is 1
		const s1 = buildRunScript({
			jobDir: '/tmp/x',
			engine: 'peft',
			config: cfg({ hfDataset: 'a/b' })
		});
		expect(s1).toContain('Attempt #1 - peft');
	});
});

describe('buildRunScript', () => {
	it('prefers uv for the venv bootstrap; the stdlib venv module is the fallback branch', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar', useVenv: true })
		});
		// reuse a healthy venv (no re-download), else create with a MANAGED cpython via uv
		expect(script).toContain('[ -x "$JOB_DIR/venv/bin/python" ]');
		expect(script).toContain('rm -rf "$JOB_DIR/venv"');
		expect(script).toContain('uv venv --python-preference only-managed --python');
		expect(script).toContain('astral.sh/uv/install.sh');
		// installs go through uv pip (not the venv's pip) so a broken system toolchain cannot poison
		// them, and uv's wheel cache is reused across jobs
		expect(script).toContain('uv pip install --python');
		// the stdlib fallback is present, but uv comes FIRST in the script (it is the preferred path)
		expect(script).toContain('python3 -m venv --clear');
		expect(script.indexOf('uv venv')).toBeLessThan(script.indexOf('python3 -m venv --clear'));
	});

	it('runs the training block in a SUBSHELL (paren, not brace) so set -e is contained', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		expect(script).toContain('set -uo pipefail');
		// the train block is a `( set -e ... ) > train.log`, never a `{ ... } > train.log`
		expect(script).toContain('(\n  set -e');
		expect(script).toContain(') > "$JOB_DIR/train.log" 2>&1');
		expect(script).not.toContain('} > "$JOB_DIR/train.log" 2>&1');
	});

	it('always writes the done.json sentinel via atomic rename after the subshell', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		expect(script).toContain(`printf '{"status":"failed","exitCode":%s}'`);
		expect(script).toContain('mv -f "$JOB_DIR/done.json.tmp" "$JOB_DIR/done.json"');
	});

	it('useSudo true wraps the train command in run_train with a sudo -S helper', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/js',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar', useSudo: true })
		});
		expect(script).toContain('run_train()');
		expect(script).toContain(`sudo -S -p ''`);
		// the train invocation is prefixed with the elevated wrapper
		expect(script).toContain('run_train ');
		// sudo resets the env, so the hf token is passed through explicitly as argv via env
		expect(script).toContain('env $HFENV "$@"');
		expect(script).toContain('HFENV="HF_TOKEN=$HF_TOKEN');
	});

	it('useSudo false (default) never defines run_train', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/js',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		expect(script).not.toContain('run_train');
	});

	it('useVenv false installs into the system python with --break-system-packages', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jv',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar', useVenv: false })
		});
		expect(script).toContain('--break-system-packages');
	});

	it('sources the login profiles so a token set only there is picked up', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		// the profile-sourcing loop (a non-interactive ssh exec skips these otherwise)
		expect(script).toContain('/etc/environment');
		expect(script).toContain('"$HOME/.profile"');
		expect(script).toContain('"$HOME/.bashrc"');
		expect(script).toMatch(/for f in[^\n]*\.profile/);
	});

	it('normalizes the token across all four hf env names', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		expect(script).toContain('HF_TOKEN');
		expect(script).toContain('HF_API_KEY');
		expect(script).toContain('HUGGINGFACE_API_TOKEN');
		expect(script).toContain('HUGGING_FACE_HUB_TOKEN');
		// the cross-populate line exports the resolved token onto every name
		expect(script).toContain(
			'export HF_TOKEN="$HF" HF_API_KEY="$HF" HUGGINGFACE_API_TOKEN="$HF" HUGGING_FACE_HUB_TOKEN="$HF"'
		);
	});

	it('stamps the requesting user into the log banner when provided', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' }),
			requestedBy: 'gmitch215'
		});
		expect(script).toContain('[job] requested by gmitch215');
	});

	it('captures hf vars from an interactive login shell and falls back to the cli token file', () => {
		const script = buildRunScript({
			jobDir: '/tmp/mylora-jobs/jr',
			engine: 'peft',
			config: cfg({ hfDataset: 'foo/bar' })
		});
		// interactive shells (-ic non-login sources .bashrc, -lic login sources the profiles) see an
		// export sitting after the .bashrc non-interactive guard
		expect(script).toContain('for _m in -ic -lic');
		expect(script).toContain('bash $_m');
		// cli-login fallback (~/.cache/huggingface/token or $HF_HOME/token)
		expect(script).toContain('.cache/huggingface}/token');
		// the log states which token path was taken (or that none was found)
		expect(script).toMatch(/\[hf\] .*token/);
	});
});

describe('buildLaunchCommand', () => {
	it('detaches via setsid nohup and injects no sudo password by default', () => {
		const cmd = buildLaunchCommand('/tmp/mylora-jobs/jl');
		expect(cmd).toContain('setsid nohup bash');
		expect(cmd).not.toContain('SUDO_PW=');
	});

	it('shq-quotes the sudo password into SUDO_PW when one is supplied', () => {
		const cmd = buildLaunchCommand('/tmp/mylora-jobs/jl', 'secret');
		expect(cmd.startsWith('SUDO_PW=')).toBe(true);
		expect(cmd).toContain(`SUDO_PW='secret'`);
	});
});

describe('buildAbortCommand', () => {
	it('does not elevate when useSudo is not set', () => {
		const cmd = buildAbortCommand('/tmp/mylora-jobs/ja', 4242);
		expect(cmd).not.toContain('sudo');
	});

	it('elevates with sudo -S when a sudo password is supplied', () => {
		const cmd = buildAbortCommand('/tmp/mylora-jobs/ja', 4242, {
			useSudo: true,
			sudoPassword: 'pw'
		});
		expect(cmd).toContain(`sudo -S -p ''`);
	});

	it('falls back to passwordless sudo -n when elevated without a password', () => {
		const cmd = buildAbortCommand('/tmp/mylora-jobs/ja', 4242, { useSudo: true });
		expect(cmd).toContain('sudo -n -- ');
	});
});
