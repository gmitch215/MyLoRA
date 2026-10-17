import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('useRuntimeConfig', () => ({ mockCf: false, public: {} }));

import {
	CLOUDFLARED_SHA256,
	SERVE_EXIT,
	buildEnvFile,
	buildServeLaunchCommand,
	buildServeProbeCommand,
	buildServeScript,
	buildServeStopCommand,
	parseServeProbe,
	serveDirFor,
	toServeTooling,
	type ServeTooling
} from '../../../src/server/utils/remote-serve';
import { DEFAULT_TOOLING } from '../../../src/shared/defaults';

const ID = 'a'.repeat(32);

describe('serveDirFor', () => {
	it('keeps every path inside the serve root and rejects a non-uuid id', () => {
		expect(serveDirFor(ID)).toBe(`/tmp/mylora-serve/${ID}`);
		expect(() => serveDirFor('../etc')).toThrow(/invalid/);
		expect(() => serveDirFor(`${ID}; rm -rf /`)).toThrow(/invalid/);
	});
});

describe('buildEnvFile', () => {
	it('exports the key and only the secrets that were given, shell-quoted', () => {
		expect(buildEnvFile({ apiKey: 'k' })).toBe("export VLLM_API_KEY='k'\n");
		const env = buildEnvFile({
			apiKey: "a'b",
			hfToken: 'hf_x',
			tunnelToken: 'tt',
			ngrokToken: 'ng_1'
		});
		expect(env).toContain("export VLLM_API_KEY='a'\\''b'");
		expect(env).toContain("export HF_TOKEN='hf_x'");
		expect(env).toContain("export TUNNEL_TOKEN='tt'");
		expect(env).toContain("export NGROK_AUTHTOKEN='ng_1'");
	});
});

describe('toServeTooling', () => {
	it('uses the built-in checksums for a known cloudflared version and none for another', () => {
		const known = toServeTooling(DEFAULT_TOOLING);
		expect(known.cloudflaredSha256).toEqual(CLOUDFLARED_SHA256[DEFAULT_TOOLING.cloudflaredVersion]);
		expect(toServeTooling({ ...DEFAULT_TOOLING, cloudflaredVersion: '2020.1.1' })).toMatchObject({
			cloudflaredSha256: null
		});
	});

	it('converts the network wait to seconds and carries the rest through', () => {
		const t = toServeTooling({
			...DEFAULT_TOOLING,
			networkWaitMinutes: 3,
			downloadRetries: 7,
			bandwidthLimitKbps: 500,
			autoInstall: false
		});
		expect(t).toMatchObject({
			networkWaitSeconds: 180,
			retries: 7,
			bandwidthKbps: 500,
			autoInstall: false,
			vllmVersion: DEFAULT_TOOLING.vllmVersion
		});
	});

	it('holds a 64 character sha256 for every built-in cloudflared version', () => {
		for (const sums of Object.values(CLOUDFLARED_SHA256)) {
			expect(sums.amd64).toMatch(/^[a-f0-9]{64}$/);
			expect(sums.arm64).toMatch(/^[a-f0-9]{64}$/);
		}
		expect(CLOUDFLARED_SHA256[DEFAULT_TOOLING.cloudflaredVersion]).toBeDefined();
	});
});

describe('buildServeScript', () => {
	const base = {
		dir: serveDirFor(ID),
		port: 8000,
		baseModel: 'meta-llama/Llama-3.1-8B-Instruct',
		maxLoraRank: 32,
		adapterNames: ['support-tone', 'legal-qa']
	};

	it('starts vllm with lora enabled and every adapter, and never puts a secret in the script', () => {
		const s = buildServeScript({ ...base, tunnel: 'ngrok' });
		expect(s).toContain("BASE_MODEL='meta-llama/Llama-3.1-8B-Instruct'");
		expect(s).toContain('"$VLLM" serve "$BASE_MODEL"');
		expect(s).toContain('--enable-lora');
		expect(s).toContain('--max-lora-rank 32');
		expect(s).toContain(`'support-tone'='${serveDirFor(ID)}/adapters/support-tone'`);
		expect(s).toContain(`'legal-qa'='${serveDirFor(ID)}/adapters/legal-qa'`);
		// the key reaches vllm through its env var, not argv where `ps` would show it
		expect(s).not.toContain('--api-key');
		expect(s).toContain('export VLLM_API_KEY');
		expect(s).toContain('--host 127.0.0.1');
	});

	it('pins vllm and the python version from the tooling', () => {
		const s = buildServeScript({ ...base, tunnel: 'ngrok' });
		expect(s).toContain(`VLLM_VERSION='${DEFAULT_TOOLING.vllmVersion}'`);
		expect(s).toContain('"vllm==$VLLM_VERSION"');
		expect(s).toContain(`PY_VERSION='${DEFAULT_TOOLING.pythonVersion}'`);
		const custom = buildServeScript({
			...base,
			tunnel: 'ngrok',
			tooling: { ...toServeTooling(DEFAULT_TOOLING), vllmVersion: '0.30.1', pythonVersion: '3.12' }
		});
		expect(custom).toContain("VLLM_VERSION='0.30.1'");
		expect(custom).toContain("PY_VERSION='3.12'");
	});

	it('picks the tunnel command for each mode', () => {
		expect(buildServeScript({ ...base, tunnel: 'ngrok' })).toContain('http "127.0.0.1:$PORT"');
		const quick = buildServeScript({ ...base, tunnel: 'cloudflared' });
		expect(quick).toContain('--url "http://127.0.0.1:$PORT"');
		expect(quick).toContain('trycloudflare');
		const named = buildServeScript({
			...base,
			tunnel: 'cloudflared',
			named: true,
			hostname: 'vllm.example.com'
		});
		expect(named).toContain('TUNNEL_TOKEN="$TUNNEL_TOKEN_VALUE"');
		expect(named).toContain("URL='https://vllm.example.com'");
		// the token goes to cloudflared through its env var, not argv where `ps` would show it
		expect(named).not.toContain('--token');
	});

	it('installs the chosen tunnel tool before the long vllm install', () => {
		const ngrok = buildServeScript({ ...base, tunnel: 'ngrok' });
		expect(ngrok.indexOf('\nensure_ngrok\n')).toBeGreaterThan(0);
		expect(ngrok.indexOf('\nensure_ngrok\n')).toBeLessThan(ngrok.indexOf('"vllm==$VLLM_VERSION"'));
		const cf = buildServeScript({ ...base, tunnel: 'cloudflared' });
		expect(cf.indexOf('\nensure_cloudflared\n')).toBeLessThan(cf.indexOf('"vllm==$VLLM_VERSION"'));
	});

	it('rejects an adapter name that could break out of the command', () => {
		expect(() => buildServeScript({ ...base, tunnel: 'ngrok', adapterNames: ['a b'] })).toThrow();
		expect(() => buildServeScript({ ...base, tunnel: 'ngrok', adapterNames: ['x;rm'] })).toThrow();
	});

	it.each(['ngrok', 'cloudflared'] as const)('is valid bash for the %s tunnel', (tunnel) => {
		const dir = mkdtempSync(join(tmpdir(), 'mylora-serve-syntax-'));
		const file = join(dir, 'run.sh');
		writeFileSync(file, buildServeScript({ ...base, tunnel }));
		expect(() => execFileSync('bash', ['-n', file])).not.toThrow();
	});
});

describe('launch, probe and stop commands', () => {
	it('detaches every fd and echoes the pid', () => {
		const cmd = buildServeLaunchCommand(serveDirFor(ID));
		expect(cmd).toContain('setsid nohup bash');
		expect(cmd).toContain('</dev/null >/dev/null 2>&1 &');
		expect(cmd).toContain('echo "$!"');
	});

	it('stop removes the directory that holds the env file, and only inside the serve root', () => {
		const cmd = buildServeStopCommand(serveDirFor(ID), 4242);
		expect(cmd).toContain('kill -TERM -- -4242');
		expect(cmd).toContain(`rm -rf '${serveDirFor(ID)}'`);
		expect(() => buildServeStopCommand('/home/user', 1)).toThrow(/outside/);
	});

	it('probe reads each marker file and both logs', () => {
		const cmd = buildServeProbeCommand(serveDirFor(ID), 77);
		for (const marker of ['@@EXIT@@', '@@HB@@', '@@PID@@', '@@READY@@', '@@URL@@', '@@LOG@@']) {
			expect(cmd).toContain(marker);
		}
		expect(cmd).toContain('serve.log');
		expect(cmd).toContain('vllm.log');
		expect(cmd).toContain('kill -0 77');
	});
});

describe('parseServeProbe', () => {
	const out = (parts: Partial<Record<string, string>>) =>
		['EXIT', 'HB', 'PID', 'READY', 'URL', 'LOG']
			.map((k) => `@@${k}@@\n${parts[k] ?? ''}\n`)
			.join('') + '@@END@@\n';

	it('parses a ready server', () => {
		const p = parseServeProbe(
			out({
				HB: '1790000000',
				PID: 'ALIVE',
				READY: 'yes',
				URL: 'https://x.trycloudflare.com',
				LOG: 'serving'
			})
		);
		expect(p).toEqual({
			exit: null,
			pidAlive: true,
			heartbeatEpoch: 1790000000,
			ready: true,
			url: 'https://x.trycloudflare.com',
			logTail: 'serving'
		});
	});

	it('parses a failure, ignores a non-https url, and survives garbage', () => {
		const failed = parseServeProbe(
			out({ EXIT: '{"code":1,"message":"vllm exited before it was ready"}', URL: 'http://evil' })
		);
		expect(failed.exit).toEqual({ code: 1, message: 'vllm exited before it was ready' });
		expect(failed.url).toBeNull();
		expect(failed.pidAlive).toBe(false);
		expect(parseServeProbe('').ready).toBe(false);
		expect(parseServeProbe(out({ EXIT: 'not json' })).exit).toEqual({ code: 1, message: 'exited' });
	});
});

// runs the generated script against stub binaries, so the control flow is exercised without a GPU
describe('serve script on a stubbed box', () => {
	const PAYLOAD_BIN =
		'#!/usr/bin/env bash\ncase "$1" in version|--version) echo stub 1.0;; *) echo https://stub-quick.trycloudflare.com; sleep 30;; esac\n';
	const GITHUB_JSON = (name: string, digest: string | null) =>
		JSON.stringify(
			{
				tag_name: 'v',
				assets: [
					{
						name: 'other-asset',
						uploader: { login: 'x' },
						digest: `sha256:${'1'.repeat(64)}`
					},
					{
						name,
						uploader: { login: 'x' },
						size: 5,
						...(digest ? { digest: `sha256:${digest}` } : {})
					}
				]
			},
			null,
			2
		);

	function box(
		opts: { ngrok?: boolean; uv?: boolean; vllm?: boolean; cloudflared?: boolean } = {}
	) {
		const { ngrok = true, uv = true, vllm = false, cloudflared = false } = opts;
		const root = mkdtempSync(join(tmpdir(), 'mylora-serve-box-'));
		const bin = join(root, 'bin');
		const home = join(root, 'home');
		const dir = join(root, 'serve');
		const ctl = join(root, 'ctl');
		for (const d of [bin, home, ctl, join(dir, 'adapters')]) mkdirSync(d, { recursive: true });
		const stub = (name: string, body: string, where = bin) => {
			writeFileSync(join(where, name), `#!/usr/bin/env bash\n${body}\n`);
			chmodSync(join(where, name), 0o755);
		};

		writeFileSync(
			join(ctl, 'python.stub'),
			`#!/usr/bin/env bash
case "$*" in
  *importlib.metadata*) cat "${ctl}/vllm_version" 2>/dev/null || echo ${DEFAULT_TOOLING.vllmVersion} ;;
  *snapshot_download*)
    echo "$*" >> "${ctl}/prefetch.log"
    n=$(cat "${ctl}/prefetch_fail" 2>/dev/null || echo 0)
    if [ "$n" -gt 0 ]; then echo $((n-1)) > "${ctl}/prefetch_fail"; exit 1; fi ;;
esac
exit 0
`
		);
		writeFileSync(
			join(ctl, 'vllm.stub'),
			`#!/usr/bin/env bash
env | grep -c '^NGROK_AUTHTOKEN=' > "${ctl}/vllm_sees_ngrok" || true
env | grep -c '^TUNNEL_TOKEN=' > "${ctl}/vllm_sees_tunnel" || true
sleep 30
`
		);
		const uvBody = `echo "$*" >> "${ctl}/uv.log"
echo "UV_HTTP_TIMEOUT=\${UV_HTTP_TIMEOUT:-} UV_CONCURRENT_DOWNLOADS=\${UV_CONCURRENT_DOWNLOADS:-}" >> "${ctl}/uv.env"
if [ "$1" = venv ]; then
  d="\${@: -1}"; mkdir -p "$d/bin"
  cp "${ctl}/python.stub" "$d/bin/python"; chmod +x "$d/bin/python"
  cp "${ctl}/vllm.stub" "$d/bin/vllm"; chmod +x "$d/bin/vllm"
fi
exit 0`;
		if (uv) stub('uv', uvBody);
		writeFileSync(join(ctl, 'uv.stub'), `#!/usr/bin/env bash\n${uvBody}\n`);
		if (ngrok)
			stub(
				'ngrok',
				`echo "$*" >> "${ctl}/ngrok.args"\ncase "$1" in version) echo ngrok version stub;; *) sleep 30;; esac`
			);
		if (vllm)
			stub(
				'vllm',
				readFileSync(join(ctl, 'vllm.stub'), 'utf8').replace('#!/usr/bin/env bash\n', '')
			);
		if (cloudflared) stub('cloudflared', PAYLOAD_BIN.replace('#!/usr/bin/env bash\n', ''));
		stub('uname', 'case "$1" in -s) echo Linux;; -m) echo x86_64;; *) echo Linux;; esac');
		stub(
			'df',
			`if [ -f "${ctl}/disk_low" ]; then printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/x 1000 999 1 99%% /\\n'; else printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/x 1000000 1 999999 1%% /\\n'; fi`
		);
		stub(
			'curl',
			`CTL="${ctl}"
args=("$@"); out=""; url=""; head=0; write=""
for ((i=0;i<\${#args[@]};i++)); do
  case "\${args[$i]}" in
    -o) out="\${args[$((i+1))]}";;
    -w) write="\${args[$((i+1))]}";;
    -I) head=1;;
    http*) url="\${args[$i]}";;
  esac
done
echo "$url" >> "$CTL/curl.log"
if [ "$head" = 1 ]; then
  n=$(cat "$CTL/net_down" 2>/dev/null || echo 0)
  if [ "$n" -gt 0 ]; then echo $((n-1)) > "$CTL/net_down"; exit 7; fi
  exit 0
fi
case "$url" in
  *api/tunnels*) echo '{"tunnels":[{"public_url":"https://stub.ngrok.app"}]}'; exit 0;;
  *api.github.com*) cat "$CTL/github.json"; exit 0;;
  */health) exit 0;;
esac
if [ -n "$out" ]; then
  n=$(cat "$CTL/dl_fail" 2>/dev/null || echo 0)
  if [ "$n" -gt 0 ]; then echo $((n-1)) > "$CTL/dl_fail"; [ -n "$write" ] && printf '%s' "$(cat "$CTL/dl_fail_code" 2>/dev/null || echo 503)"; exit 0; fi
  [ -f "$CTL/payload" ] && cp "$CTL/payload" "$out"
  [ -n "$write" ] && printf '200'
fi
exit 0`
		);
		return { root, bin, home, dir, ctl };
	}

	type Box = ReturnType<typeof box>;

	const tooling = (over: Partial<ServeTooling> = {}): ServeTooling => ({
		...toServeTooling(DEFAULT_TOOLING),
		retryBaseSeconds: 0,
		netPollSeconds: 1,
		networkWaitSeconds: 3,
		...over
	});

	const opts = (b: Box, over: Record<string, unknown> = {}) => ({
		dir: b.dir,
		port: 8011,
		baseModel: 'org/model',
		maxLoraRank: 16,
		adapterNames: ['one'],
		tunnel: 'ngrok' as const,
		tooling: tooling(),
		...over
	});

	async function run(
		b: Box,
		script: string,
		waitFor: string | string[],
		env: { secrets?: Parameters<typeof buildEnvFile>[0]; onReady?: () => void } = {}
	): Promise<void> {
		// a relative name is a marker in the serve dir; stubs start in the background, so a test that
		// reads what one logged also waits for that file
		const pending = (Array.isArray(waitFor) ? waitFor : [waitFor]).map((p) =>
			isAbsolute(p) ? p : join(b.dir, p)
		);
		writeFileSync(join(b.dir, 'run.sh'), script);
		writeFileSync(join(b.dir, 'env'), buildEnvFile(env.secrets ?? { apiKey: 'test-key' }));
		const child = spawn('bash', [join(b.dir, 'run.sh')], {
			env: { ...process.env, HOME: b.home, PATH: `${b.bin}:/usr/bin:/bin` },
			detached: true,
			stdio: 'ignore'
		});
		const deadline = Date.now() + 25_000;
		while (Date.now() < deadline && !pending.every((p) => existsSync(p))) {
			await new Promise((r) => setTimeout(r, 100));
		}
		env.onReady?.();
		try {
			process.kill(-child.pid!, 'SIGTERM');
		} catch {
			// already gone
		}
	}

	const exitOf = (b: Box) => JSON.parse(readFileSync(join(b.dir, 'exit'), 'utf8'));
	const logOf = (b: Box) => readFileSync(join(b.dir, 'serve.log'), 'utf8');
	const read = (b: Box, name: string) => readFileSync(join(b.ctl, name), 'utf8');
	const sha = (text: string) => createHash('sha256').update(text).digest('hex');
	const sums = (digest: string) => ({ amd64: digest, arm64: digest });

	function tgzWithNgrok(b: Box): string {
		const src = join(b.root, 'pack');
		mkdirSync(src);
		writeFileSync(
			join(src, 'ngrok'),
			`#!/usr/bin/env bash\ncase "$1" in version) echo ngrok version stub;; *) echo "$*" >> "${b.ctl}/ngrok.args"; sleep 30;; esac\n`
		);
		chmodSync(join(src, 'ngrok'), 0o755);
		const tgz = join(b.root, 'ngrok.tgz');
		execFileSync('tar', ['-czf', tgz, '-C', src, 'ngrok']);
		return tgz;
	}

	describe('ready path', () => {
		it('reaches ready with the tunnel url and pins the vllm install', async () => {
			const b = box();
			await run(b, buildServeScript(opts(b)), 'ready');
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(readFileSync(join(b.dir, 'url'), 'utf8')).toBe('https://stub.ngrok.app');
			expect(existsSync(join(b.dir, 'exit'))).toBe(false);
			expect(read(b, 'uv.log')).toContain(
				`pip install --no-progress --python venv/bin/python vllm==${DEFAULT_TOOLING.vllmVersion}`
			);
			expect(read(b, 'uv.env')).toContain('UV_HTTP_TIMEOUT=120');
			expect(logOf(b)).toContain('[tooling] auto install 1');
		}, 30_000);

		it('downloads the model with the prefetch step before vllm starts', async () => {
			const b = box();
			await run(b, buildServeScript(opts(b)), 'ready');
			expect(read(b, 'prefetch.log')).toContain('org/model');
			expect(read(b, 'prefetch.log')).toMatch(/org\/model 4$/m);
		}, 30_000);

		it('limits parallel downloads when a bandwidth limit is set', async () => {
			const b = box();
			await run(
				b,
				buildServeScript(opts(b, { tooling: tooling({ bandwidthKbps: 250 }) })),
				'ready'
			);
			expect(read(b, 'uv.env')).toContain('UV_CONCURRENT_DOWNLOADS=1');
			expect(read(b, 'prefetch.log')).toMatch(/org\/model 1$/m);
		}, 30_000);

		it('keeps tunnel and ngrok secrets out of the vllm environment', async () => {
			const b = box();
			await run(
				b,
				buildServeScript(opts(b)),
				['ready', join(b.ctl, 'vllm_sees_ngrok'), join(b.ctl, 'vllm_sees_tunnel')],
				{
					secrets: { apiKey: 'k', ngrokToken: 'ngrok_secret_token_000000', tunnelToken: 'cf_token' }
				}
			);
			expect(read(b, 'vllm_sees_ngrok').trim()).toBe('0');
			expect(read(b, 'vllm_sees_tunnel').trim()).toBe('0');
		}, 30_000);
	});

	describe('ngrok', () => {
		it('hands a supplied authtoken to ngrok through a private config file, not argv', async () => {
			const b = box();
			const yml = join(b.dir, 'ngrok.yml');
			let contents = '';
			let mode = 0;
			await run(b, buildServeScript(opts(b)), ['ready', join(b.ctl, 'ngrok.args')], {
				secrets: { apiKey: 'k', ngrokToken: 'ngrok_secret_token_000000' },
				onReady: () => {
					contents = readFileSync(yml, 'utf8');
					mode = statSync(yml).mode & 0o777;
				}
			});
			expect(contents).toBe('version: 3\nagent:\n  authtoken: ngrok_secret_token_000000\n');
			expect(mode).toBe(0o600);
			const args = read(b, 'ngrok.args');
			expect(args).toContain(`--config ${b.dir}/ngrok.yml`);
			expect(args).not.toContain('ngrok_secret_token_000000');
			expect(logOf(b)).toContain('authtoken MyLoRA supplied');
		}, 30_000);

		it('deletes the env file once it has read it and the ngrok config when the job ends', async () => {
			const b = box();
			let envLeft = true;
			let ymlDuring = false;
			await run(b, buildServeScript(opts(b)), ['ready', join(b.ctl, 'ngrok.args')], {
				secrets: { apiKey: 'k', ngrokToken: 'ngrok_secret_token_000000' },
				onReady: () => {
					envLeft = existsSync(join(b.dir, 'env'));
					ymlDuring = existsSync(join(b.dir, 'ngrok.yml'));
				}
			});
			expect(envLeft).toBe(false);
			expect(ymlDuring).toBe(true);
			// the stop signal runs the cleanup trap
			for (let i = 0; i < 30 && existsSync(join(b.dir, 'ngrok.yml')); i++) {
				await new Promise((r) => setTimeout(r, 100));
			}
			expect(existsSync(join(b.dir, 'ngrok.yml'))).toBe(false);
		}, 30_000);

		it('leaves ngrok on the machine sign in when no token is supplied', async () => {
			const b = box();
			await run(b, buildServeScript(opts(b)), ['ready', join(b.ctl, 'ngrok.args')]);
			expect(existsSync(join(b.dir, 'ngrok.yml'))).toBe(false);
			expect(read(b, 'ngrok.args')).not.toContain('--config');
			expect(logOf(b)).toContain("machine's own sign in");
		}, 30_000);

		it('installs ngrok when it is missing and installs are on', async () => {
			const b = box({ ngrok: false });
			copyPayload(b, tgzWithNgrok(b));
			await run(b, buildServeScript(opts(b)), 'ready');
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(existsSync(join(b.home, '.local/share/mylora/tools/ngrok'))).toBe(true);
			expect(read(b, 'curl.log')).toContain('ngrok-v3-stable-linux-amd64.tgz');
			expect(logOf(b)).toMatch(/ngrok archive sha256 [a-f0-9]{64}/);
		}, 30_000);

		it('refuses a download that is not an ngrok archive', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), 'not a tarball');
			await run(b, buildServeScript(opts(b)), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.installFailed);
			expect(exitOf(b).message).toMatch(/does not contain an ngrok binary/);
		}, 30_000);

		it('stops with a clear code when ngrok is missing and installs are off', async () => {
			const b = box({ ngrok: false });
			await run(b, buildServeScript(opts(b, { tooling: tooling({ autoInstall: false }) })), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.toolMissing);
			expect(exitOf(b).message).toMatch(/ngrok is not installed.*automatic installs are off/);
			expect(existsSync(join(b.ctl, 'curl.log'))).toBe(false);
			expect(existsSync(join(b.dir, 'ready'))).toBe(false);
		}, 30_000);
	});

	function copyPayload(b: Box, from: string) {
		writeFileSync(join(b.ctl, 'payload'), readFileSync(from));
	}

	describe('cloudflared', () => {
		const cfOpts = (b: Box, over: Partial<ServeTooling> = {}) =>
			opts(b, { tunnel: 'cloudflared', tooling: tooling(over) });

		it('installs the pinned binary when its checksum matches', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), PAYLOAD_BIN);
			await run(
				b,
				buildServeScript(cfOpts(b, { cloudflaredSha256: sums(sha(PAYLOAD_BIN)) })),
				'ready'
			);
			expect(readFileSync(join(b.dir, 'url'), 'utf8')).toBe('https://stub-quick.trycloudflare.com');
			const installed = join(
				b.home,
				`.local/share/mylora/tools/cloudflared-${DEFAULT_TOOLING.cloudflaredVersion}`
			);
			expect(statSync(installed).mode & 0o111).not.toBe(0);
			expect(read(b, 'curl.log')).toContain(
				`/releases/download/${DEFAULT_TOOLING.cloudflaredVersion}/cloudflared-linux-amd64`
			);
			expect(logOf(b)).toContain('sha256 matched');
		}, 30_000);

		it('rejects a wrong checksum on every attempt and installs nothing', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), PAYLOAD_BIN);
			await run(
				b,
				buildServeScript(cfOpts(b, { cloudflaredSha256: sums('0'.repeat(64)), retries: 3 })),
				'exit'
			);
			const exit = exitOf(b);
			expect(exit.code).toBe(SERVE_EXIT.checksum);
			expect(exit.message).toMatch(/checksum mismatch.*all 3 attempts/);
			const downloads = read(b, 'curl.log')
				.split('\n')
				.filter((l) => l.includes('cloudflared-linux-amd64'));
			expect(downloads).toHaveLength(3);
			expect(
				existsSync(
					join(
						b.home,
						`.local/share/mylora/tools/cloudflared-${DEFAULT_TOOLING.cloudflaredVersion}`
					)
				)
			).toBe(false);
			expect(existsSync(join(b.dir, 'ready'))).toBe(false);
		}, 30_000);

		it('retries through server throttling and then installs', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), PAYLOAD_BIN);
			writeFileSync(join(b.ctl, 'dl_fail'), '2');
			writeFileSync(join(b.ctl, 'dl_fail_code'), '429');
			await run(
				b,
				buildServeScript(cfOpts(b, { cloudflaredSha256: sums(sha(PAYLOAD_BIN)) })),
				'ready'
			);
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(logOf(b)).toContain('the server is throttling requests (HTTP 429)');
			expect(logOf(b)).toContain('attempt 3 of');
		}, 30_000);

		it('gives up with a download error after the configured attempts', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'dl_fail'), '10');
			await run(b, buildServeScript(cfOpts(b, { retries: 2 })), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.installFailed);
			expect(exitOf(b).message).toMatch(/could not download .* after 2 attempts/);
		}, 30_000);

		it('waits out a short outage before downloading', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), PAYLOAD_BIN);
			writeFileSync(join(b.ctl, 'net_down'), '2');
			await run(
				b,
				buildServeScript(cfOpts(b, { cloudflaredSha256: sums(sha(PAYLOAD_BIN)) })),
				'ready'
			);
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(logOf(b)).toContain('waiting for the network');
		}, 30_000);

		it('fails with a network code when the outage outlasts the wait', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'net_down'), '1000');
			await run(b, buildServeScript(cfOpts(b, { networkWaitSeconds: 2 })), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.network);
			expect(exitOf(b).message).toMatch(/cannot reach github.com.*network stayed down/);
		}, 30_000);

		it('reports a full disk instead of retrying forever', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'dl_fail'), '10');
			writeFileSync(join(b.ctl, 'disk_low'), '1');
			await run(b, buildServeScript(cfOpts(b)), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.disk);
			expect(exitOf(b).message).toMatch(/under 512 MB free/);
		}, 30_000);

		it('reads the release digest for a version with no built-in checksum', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), PAYLOAD_BIN);
			writeFileSync(
				join(b.ctl, 'github.json'),
				GITHUB_JSON('cloudflared-linux-amd64', sha(PAYLOAD_BIN))
			);
			await run(
				b,
				buildServeScript(cfOpts(b, { cloudflaredVersion: '2030.1.1', cloudflaredSha256: null })),
				'ready'
			);
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(read(b, 'curl.log')).toContain(
				'api.github.com/repos/cloudflare/cloudflared/releases/tags/2030.1.1'
			);
			expect(logOf(b)).toContain('no built-in checksum for cloudflared 2030.1.1');
		}, 30_000);

		it('installs nothing when the release has no digest to check against', async () => {
			const b = box({ ngrok: false });
			writeFileSync(join(b.ctl, 'payload'), PAYLOAD_BIN);
			writeFileSync(join(b.ctl, 'github.json'), GITHUB_JSON('cloudflared-linux-amd64', null));
			await run(
				b,
				buildServeScript(
					cfOpts(b, { cloudflaredVersion: '2030.1.1', cloudflaredSha256: null, retries: 2 })
				),
				'exit'
			);
			expect(exitOf(b).code).toBe(SERVE_EXIT.checksum);
			expect(exitOf(b).message).toMatch(/no checksum is available for cloudflared 2030.1.1/);
		}, 30_000);

		it('uses a cloudflared already on the machine without downloading', async () => {
			const b = box({ ngrok: false, cloudflared: true });
			await run(b, buildServeScript(cfOpts(b)), 'ready');
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(existsSync(join(b.ctl, 'curl.log')) ? read(b, 'curl.log') : '').not.toContain(
				'cloudflared-linux'
			);
		}, 30_000);

		it('stops with a clear code when it is missing and installs are off', async () => {
			const b = box({ ngrok: false });
			await run(b, buildServeScript(cfOpts(b, { autoInstall: false })), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.toolMissing);
			expect(exitOf(b).message).toMatch(/cloudflared is not installed/);
		}, 30_000);
	});

	describe('vllm', () => {
		it('fails when the installed version is not the pinned one', async () => {
			const b = box();
			writeFileSync(join(b.ctl, 'vllm_version'), '0.1.0');
			await run(b, buildServeScript(opts(b)), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.installFailed);
			expect(exitOf(b).message).toMatch(/expected vllm .* but the environment has '0.1.0'/);
		}, 30_000);

		it('retries a model download that keeps failing, then continues', async () => {
			const b = box();
			writeFileSync(join(b.ctl, 'prefetch_fail'), '2');
			await run(b, buildServeScript(opts(b)), 'ready');
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(logOf(b)).toContain('[download the model] attempt 3 of');
		}, 30_000);

		it('stops when the model never downloads', async () => {
			const b = box();
			writeFileSync(join(b.ctl, 'prefetch_fail'), '10');
			await run(b, buildServeScript(opts(b, { tooling: tooling({ retries: 2 }) })), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.installFailed);
			expect(exitOf(b).message).toMatch(/could not download org\/model after 2 attempts/);
		}, 30_000);

		it('uses the machine vllm and never touches uv when installs are off', async () => {
			const b = box({ uv: false, vllm: true });
			await run(
				b,
				buildServeScript(opts(b, { tooling: tooling({ autoInstall: false }) })),
				'ready'
			);
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(existsSync(join(b.ctl, 'uv.log'))).toBe(false);
			expect(logOf(b)).toContain('[vllm] using');
		}, 30_000);

		it('stops with a clear code when vllm is missing and installs are off', async () => {
			const b = box({ uv: false });
			await run(b, buildServeScript(opts(b, { tooling: tooling({ autoInstall: false }) })), 'exit');
			expect(exitOf(b).code).toBe(SERVE_EXIT.toolMissing);
			expect(exitOf(b).message).toMatch(/vllm is not installed/);
		}, 30_000);

		it('installs uv through the retrying downloader when it is missing', async () => {
			const b = box({ uv: false });
			writeFileSync(
				join(b.ctl, 'payload'),
				`#!/bin/sh\nmkdir -p "$HOME/.local/bin"\ncp "${join(b.ctl, 'uv.stub')}" "$HOME/.local/bin/uv"\nchmod +x "$HOME/.local/bin/uv"\n`
			);
			await run(b, buildServeScript(opts(b)), 'ready');
			expect(existsSync(join(b.dir, 'ready'))).toBe(true);
			expect(read(b, 'curl.log')).toContain('astral.sh/uv/install.sh');
		}, 30_000);

		it('writes an exit record when vllm never answers and its process dies', async () => {
			const b = box({ ngrok: true });
			writeFileSync(join(b.ctl, 'vllm.stub'), '#!/usr/bin/env bash\nexit 3\n');
			// the health probe never succeeds in this box
			writeFileSync(
				join(b.bin, 'curl'),
				readFileSync(join(b.bin, 'curl'), 'utf8').replace(
					'*/health) exit 0;;',
					'*/health) exit 1;;'
				)
			);
			await run(b, buildServeScript(opts(b)), 'exit');
			expect(exitOf(b).message).toMatch(/vllm exited before it was ready/);
		}, 30_000);
	});
});
