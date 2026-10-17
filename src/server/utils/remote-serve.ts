import { DEFAULT_TOOLING } from '~/shared/defaults';
import type { ServeTunnel, ToolingSettings } from '~/shared/types';
import { classifyError, connectOpts, edge, isMockSsh, type RemoteCreds } from './remote';
import { shq } from './remote-commands';

export const SERVE_ROOT = '/tmp/mylora-serve';
const SERVE_ID_RE = /^[a-f0-9]{32}$/;
const MODEL_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

// the serve id is a uuid, which also keeps every path below inside SERVE_ROOT
export function serveDirFor(id: string): string {
	if (!SERVE_ID_RE.test(id)) throw new Error('invalid serve id');
	return `${SERVE_ROOT}/${id}`;
}

export type ServeAdapterFile = { name: string; config: Blob | null; weights: Blob };

// sha256 of the official linux release assets, from the GitHub release API digest and re-checked
// against the downloaded binaries; any other version reads its digest from the release at install time
export const CLOUDFLARED_SHA256: Record<string, { amd64: string; arm64: string }> = {
	'2026.10.1': {
		amd64: '3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586',
		arm64: '2c65dfabf616c40efc7545d107d7a57ad5e21377e2964b7e88af19a238074a46'
	},
	'2026.10.0': {
		amd64: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db',
		arm64: 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08'
	},
	'2026.9.3': {
		amd64: '77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2',
		arm64: 'aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d'
	}
};

// exit codes the script writes to its exit file
export const SERVE_EXIT = {
	network: 10,
	checksum: 11,
	disk: 12,
	toolMissing: 13,
	installFailed: 14
} as const;

export type ServeTooling = {
	autoInstall: boolean;
	pythonVersion: string;
	vllmVersion: string;
	cloudflaredVersion: string;
	cloudflaredSha256: { amd64: string; arm64: string } | null;
	retries: number;
	networkWaitSeconds: number;
	bandwidthKbps: number;
	// seconds; only the tests shorten these
	retryBaseSeconds?: number;
	netPollSeconds?: number;
};

export function toServeTooling(settings: ToolingSettings): ServeTooling {
	return {
		autoInstall: settings.autoInstall,
		pythonVersion: settings.pythonVersion,
		vllmVersion: settings.vllmVersion,
		cloudflaredVersion: settings.cloudflaredVersion,
		cloudflaredSha256: CLOUDFLARED_SHA256[settings.cloudflaredVersion] ?? null,
		retries: settings.downloadRetries,
		networkWaitSeconds: settings.networkWaitMinutes * 60,
		bandwidthKbps: settings.bandwidthLimitKbps
	};
}

export type ServeScriptOpts = {
	dir: string;
	port: number;
	baseModel: string;
	maxLoraRank: number;
	tunnel: ServeTunnel;
	// a named cloudflared tunnel: the token comes from the env file, the url from this hostname
	hostname?: string | null;
	named?: boolean;
	adapterNames: string[];
	tooling?: ServeTooling;
};

// where the launch secrets live on the box: a 700 directory holds this 600 file, and stop removes both
export function buildEnvFile(secrets: {
	apiKey: string;
	hfToken?: string | null;
	tunnelToken?: string | null;
	ngrokToken?: string | null;
}): string {
	const lines = [`export VLLM_API_KEY=${shq(secrets.apiKey)}`];
	if (secrets.hfToken) lines.push(`export HF_TOKEN=${shq(secrets.hfToken)}`);
	if (secrets.tunnelToken) lines.push(`export TUNNEL_TOKEN=${shq(secrets.tunnelToken)}`);
	if (secrets.ngrokToken) lines.push(`export NGROK_AUTHTOKEN=${shq(secrets.ngrokToken)}`);
	return `${lines.join('\n')}\n`;
}

const whole = (n: number, min: number) => Math.max(min, Math.trunc(Number(n) || 0));

/** vllm serve with LoRA enabled, behind the chosen tunnel; every secret arrives through ./env. */
export function buildServeScript(opts: ServeScriptOpts): string {
	for (const n of opts.adapterNames) {
		if (!MODEL_NAME_RE.test(n)) throw new Error(`invalid adapter name: ${n}`);
	}
	const t = opts.tooling ?? toServeTooling(DEFAULT_TOOLING);
	const dir = shq(opts.dir);
	const loraModules = opts.adapterNames
		.map((n) => `${shq(n)}=${shq(`${opts.dir}/adapters/${n}`)}`)
		.join(' ');
	const tunnelStart =
		opts.tunnel === 'ngrok'
			? `NGROK_ARGS=""
  if [ -n "$NGROK_TOKEN_VALUE" ]; then
    printf 'version: 3\\nagent:\\n  authtoken: %s\\n' "$NGROK_TOKEN_VALUE" > ngrok.yml
    NGROK_ARGS="--config $SERVE_DIR/ngrok.yml"
    say "[tunnel] ngrok uses the authtoken MyLoRA supplied"
  else
    say "[tunnel] ngrok uses the machine's own sign in"
  fi
  say "[tunnel] starting ngrok http $PORT"
  "$NGROK" http "127.0.0.1:$PORT" $NGROK_ARGS --log=stdout > tunnel.log 2>&1 &
  echo $! > tunnel.pid
  for _ in $(seq 1 60); do
    URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https:[^"]*"' | head -1 | cut -d'"' -f4)
    [ -n "$URL" ] && break
    kill -0 "$(cat tunnel.pid)" 2>/dev/null || { tail -n 8 tunnel.log; fail 1 'ngrok exited; check the authtoken, or run ngrok config add-authtoken on this machine'; }
    sleep 1
  done`
			: opts.named
				? `say "[tunnel] starting the named cloudflared tunnel"
  TUNNEL_TOKEN="$TUNNEL_TOKEN_VALUE" "$CLOUDFLARED" tunnel --no-autoupdate run > tunnel.log 2>&1 &
  echo $! > tunnel.pid
  URL=${shq(`https://${opts.hostname ?? ''}`)}`
				: `say "[tunnel] starting a cloudflared quick tunnel"
  "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > tunnel.log 2>&1 &
  echo $! > tunnel.pid
  for _ in $(seq 1 60); do
    URL=$(grep -o 'https://[a-z0-9-]*\\.trycloudflare\\.com' tunnel.log 2>/dev/null | head -1)
    [ -n "$URL" ] && break
    kill -0 "$(cat tunnel.pid)" 2>/dev/null || { tail -n 8 tunnel.log; fail 1 'cloudflared exited; see the log above'; }
    sleep 1
  done`;

	const ensureTunnelTool = opts.tunnel === 'ngrok' ? 'ensure_ngrok' : 'ensure_cloudflared';

	return `#!/usr/bin/env bash
set -uo pipefail
umask 077
SERVE_DIR=${dir}
PORT=${Math.trunc(opts.port)}
cd "$SERVE_DIR"
echo $$ > pid
exec >> serve.log 2>&1
say() { printf '[%s] %s\\n' "$(date -u +%H:%M:%S)" "$*"; }
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
set +u
. ./env 2>/dev/null
NGROK_TOKEN_VALUE=\${NGROK_AUTHTOKEN:-}
TUNNEL_TOKEN_VALUE=\${TUNNEL_TOKEN:-}
unset NGROK_AUTHTOKEN TUNNEL_TOKEN
rm -f env
set -u
if [ -z "\${HF_TOKEN:-}" ]; then
  for tf in "\${HF_HOME:-$HOME/.cache/huggingface}/token" "$HOME/.huggingface/token"; do
    if [ -r "$tf" ]; then HF_TOKEN=$(tr -d '\\r\\n' < "$tf"); [ -n "$HF_TOKEN" ] && break; fi
  done
fi
if [ -n "\${HF_TOKEN:-}" ]; then export HF_TOKEN HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"; fi
export VLLM_API_KEY

AUTO_INSTALL=${t.autoInstall ? 1 : 0}
RETRIES=${whole(t.retries, 1)}
NET_WAIT=${whole(t.networkWaitSeconds, 0)}
LIMIT_KBPS=${whole(t.bandwidthKbps, 0)}
RETRY_BASE=${whole(t.retryBaseSeconds ?? 2, 0)}
NET_POLL=${whole(t.netPollSeconds ?? 15, 1)}
PY_VERSION=${shq(t.pythonVersion)}
VLLM_VERSION=${shq(t.vllmVersion)}
CF_VERSION=${shq(t.cloudflaredVersion)}
CF_SHA_AMD64=${shq(t.cloudflaredSha256?.amd64 ?? '')}
CF_SHA_ARM64=${shq(t.cloudflaredSha256?.arm64 ?? '')}
BASE_MODEL=${shq(opts.baseModel)}
TOOLS="$HOME/.local/share/mylora/tools"
RATE_ARGS=""
if [ "$LIMIT_KBPS" -gt 0 ]; then RATE_ARGS="--limit-rate \${LIMIT_KBPS}k"; fi

fail() {
  local code=$1
  shift
  local msg
  msg=$(printf '%s' "$*" | tr -d '"\\\\' | tr '\\n' ' ')
  say "[error] $*"
  printf '{"code":%s,"message":"%s"}' "$code" "$msg" > exit.tmp
  mv -f exit.tmp exit
  exit 1
}

net_up() { curl -sS -I -m 8 -o /dev/null "https://$1/" >/dev/null 2>&1; }

wait_net() {
  local host=$1 waited=0
  while ! net_up "$host"; do
    if [ "$waited" -ge "$NET_WAIT" ]; then return 1; fi
    say "[net] cannot reach $host; waiting for the network ($waited of $NET_WAIT s)"
    sleep "$NET_POLL"
    waited=$((waited + NET_POLL))
  done
}

pause() {
  local d=$((RETRY_BASE * (1 << ($1 - 1))))
  if [ "$d" -gt 120 ]; then d=120; fi
  say "[retry] trying again in $d s"
  sleep "$d"
}

disk_low() {
  local kb
  kb=$(df -Pk "$SERVE_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
  [ -n "$kb" ] && [ "$kb" -lt 524288 ]
}

run_retry() {
  local label=$1 host=$2 n=0
  shift 2
  while [ "$n" -lt "$RETRIES" ]; do
    n=$((n + 1))
    wait_net "$host" || fail ${SERVE_EXIT.network} "cannot reach $host to $label; the network stayed down for $NET_WAIT s"
    say "[$label] attempt $n of $RETRIES"
    if "$@"; then return 0; fi
    if disk_low; then fail ${SERVE_EXIT.disk} "the disk has under 512 MB free while trying to $label"; fi
    if [ "$n" -lt "$RETRIES" ]; then pause "$n"; fi
  done
  return 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

fetch_once() {
  SUMFAIL=0
  rm -f "$2.part"
  local code
  code=$(curl -sSL --retry 2 --connect-timeout 20 --max-time 1800 $RATE_ARGS -o "$2.part" -w '%{http_code}' "$1") || { say "[download] could not fetch $1"; return 1; }
  case "$code" in
    2??) ;;
    429|503) say "[download] the server is throttling requests (HTTP $code)"; return 1 ;;
    *) say "[download] HTTP $code from $1"; return 1 ;;
  esac
  if [ -n "$3" ]; then
    local got
    got=$(sha256_of "$2.part")
    if [ "$got" != "$3" ]; then
      say "[download] checksum mismatch (expected $3, got $got)"
      SUMFAIL=1
      return 1
    fi
  fi
}

fetch_verified() {
  if run_retry "download $(basename "$2")" "$4" fetch_once "$1" "$2" "$3"; then
    mv -f "$2.part" "$2"
  elif [ "$SUMFAIL" = 1 ]; then
    fail ${SERVE_EXIT.checksum} "checksum mismatch for $1 on all $RETRIES attempts"
  else
    fail ${SERVE_EXIT.installFailed} "could not download $1 after $RETRIES attempts"
  fi
}

need_install() {
  if [ "$AUTO_INSTALL" != 1 ]; then fail ${SERVE_EXIT.toolMissing} "$1 is not installed on this machine and automatic installs are off for it"; fi
}

set_arch() {
  if [ "$(uname -s)" != Linux ]; then fail ${SERVE_EXIT.installFailed} "automatic installs support Linux only; install $1 on this machine"; fi
  case "$(uname -m)" in
    x86_64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) fail ${SERVE_EXIT.installFailed} "no $1 build for $(uname -m); install it on this machine" ;;
  esac
}

digest_once() {
  DIGEST=$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/cloudflare/cloudflared/releases/tags/$CF_VERSION" 2>/dev/null | tr -d '\\n' | sed 's/.*"name": *"cloudflared-linux-'"$ARCH"'"//' | grep -oE '"digest": *"sha256:[a-f0-9]{64}"' | head -1 | grep -oE '[a-f0-9]{64}')
  [ -n "$DIGEST" ]
}

ensure_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED=$(command -v cloudflared)
    say "[tunnel] using cloudflared at $CLOUDFLARED"
    return 0
  fi
  CLOUDFLARED="$TOOLS/cloudflared-$CF_VERSION"
  if [ -x "$CLOUDFLARED" ]; then
    say "[tunnel] using the installed cloudflared $CF_VERSION"
    return 0
  fi
  need_install cloudflared
  set_arch cloudflared
  if [ "$ARCH" = amd64 ]; then WANT=$CF_SHA_AMD64; else WANT=$CF_SHA_ARM64; fi
  if [ -z "$WANT" ]; then
    say "[tunnel] no built-in checksum for cloudflared $CF_VERSION; reading the release digest"
    DIGEST=""
    run_retry "read the cloudflared $CF_VERSION digest" api.github.com digest_once || fail ${SERVE_EXIT.checksum} "no checksum is available for cloudflared $CF_VERSION, so it was not installed"
    WANT=$DIGEST
  fi
  mkdir -p "$TOOLS"
  fetch_verified "https://github.com/cloudflare/cloudflared/releases/download/$CF_VERSION/cloudflared-linux-$ARCH" "$CLOUDFLARED" "$WANT" github.com
  chmod +x "$CLOUDFLARED"
  "$CLOUDFLARED" --version >/dev/null 2>&1 || { rm -f "$CLOUDFLARED"; fail ${SERVE_EXIT.installFailed} "the downloaded cloudflared does not run on this machine"; }
  say "[tunnel] installed cloudflared $CF_VERSION (sha256 matched $WANT)"
}

ensure_ngrok() {
  if command -v ngrok >/dev/null 2>&1; then
    NGROK=$(command -v ngrok)
    say "[tunnel] using ngrok at $NGROK"
    return 0
  fi
  NGROK="$TOOLS/ngrok"
  if [ -x "$NGROK" ]; then
    say "[tunnel] using the installed ngrok"
    return 0
  fi
  need_install ngrok
  set_arch ngrok
  mkdir -p "$TOOLS"
  say "[tunnel] ngrok publishes no checksum, so only the archive layout and the binary are checked"
  fetch_verified "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-$ARCH.tgz" "$TOOLS/.ngrok.tgz" "" bin.equinox.io
  LISTING=$(tar -tzf "$TOOLS/.ngrok.tgz" 2>/dev/null)
  grep -qx ngrok <<< "$LISTING" || fail ${SERVE_EXIT.installFailed} "the ngrok archive does not contain an ngrok binary"
  say "[tunnel] ngrok archive sha256 $(sha256_of "$TOOLS/.ngrok.tgz")"
  XDIR=$(mktemp -d "$TOOLS/.unpack.XXXXXX")
  tar -xzf "$TOOLS/.ngrok.tgz" -C "$XDIR" ngrok
  mv -f "$XDIR/ngrok" "$NGROK"
  rm -rf "$XDIR" "$TOOLS/.ngrok.tgz"
  chmod +x "$NGROK"
  "$NGROK" version >/dev/null 2>&1 || { rm -f "$NGROK"; fail ${SERVE_EXIT.installFailed} "the downloaded ngrok does not run on this machine"; }
  say "[tunnel] installed $("$NGROK" version)"
}

install_uv() {
  curl -LsSf $RATE_ARGS --connect-timeout 20 --max-time 600 https://astral.sh/uv/install.sh -o uv-install.sh && sh uv-install.sh
}

ensure_uv() {
  if command -v uv >/dev/null 2>&1; then return 0; fi
  need_install uv
  say "[venv] uv not found; installing it"
  run_retry "install uv" astral.sh install_uv || fail ${SERVE_EXIT.installFailed} "could not install uv after $RETRIES attempts"
  command -v uv >/dev/null 2>&1 || fail ${SERVE_EXIT.installFailed} "uv was installed but is not on the PATH"
}

make_venv() {
  rm -rf venv
  uv venv --python-preference only-managed --python "$PY_VERSION" venv
}

prefetch_model() {
  HF_HUB_DOWNLOAD_TIMEOUT=60 HF_HUB_ETAG_TIMEOUT=30 venv/bin/python -c 'import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], max_workers=int(sys.argv[2]), allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt", "*.tiktoken"])' "$BASE_MODEL" "$HF_WORKERS"
}

( while true; do date +%s > heartbeat; sleep 10; done ) &
HB=$!
cleanup() {
  rm -f ngrok.yml
  kill "$HB" 2>/dev/null || true
  [ -f tunnel.pid ] && kill "$(cat tunnel.pid)" 2>/dev/null || true
  [ -f vllm.pid ] && kill "$(cat vllm.pid)" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM INT

say "[tooling] auto install $AUTO_INSTALL, vllm $VLLM_VERSION, python $PY_VERSION, retries $RETRIES, network wait $NET_WAIT s, bandwidth limit $LIMIT_KBPS kB/s"
${ensureTunnelTool}
export UV_HTTP_TIMEOUT=120 UV_HTTP_RETRIES=5
HF_WORKERS=4
if [ "$LIMIT_KBPS" -gt 0 ]; then
  export UV_CONCURRENT_DOWNLOADS=1
  HF_WORKERS=1
fi
if [ "$AUTO_INSTALL" = 1 ]; then
  say "[venv] preparing the environment (python $PY_VERSION)"
  ensure_uv
  if [ ! -x venv/bin/python ]; then
    run_retry "create the python environment" github.com make_venv || fail ${SERVE_EXIT.installFailed} "could not create the python environment after $RETRIES attempts"
  fi
  say "[vllm] installing vllm==$VLLM_VERSION (cached wheels are reused)"
  run_retry "install vllm $VLLM_VERSION" pypi.org uv pip install --no-progress --python venv/bin/python "vllm==$VLLM_VERSION" || fail ${SERVE_EXIT.installFailed} "vllm $VLLM_VERSION did not install after $RETRIES attempts"
  GOT=$(venv/bin/python -c 'import importlib.metadata as m; print(m.version("vllm"))' 2>/dev/null)
  if [ "$GOT" != "$VLLM_VERSION" ]; then fail ${SERVE_EXIT.installFailed} "expected vllm $VLLM_VERSION but the environment has '$GOT'"; fi
  VLLM=venv/bin/vllm
  say "[model] downloading $BASE_MODEL (an interrupted download resumes)"
  run_retry "download the model" huggingface.co prefetch_model || fail ${SERVE_EXIT.installFailed} "could not download $BASE_MODEL after $RETRIES attempts; for a gated model check the HuggingFace token"
else
  command -v vllm >/dev/null 2>&1 || fail ${SERVE_EXIT.toolMissing} "vllm is not installed on this machine and automatic installs are off for it"
  VLLM=$(command -v vllm)
  say "[vllm] using $VLLM"
fi
say "[vllm] starting $BASE_MODEL with ${opts.adapterNames.length} adapter(s)"
"$VLLM" serve "$BASE_MODEL" --host 127.0.0.1 --port "$PORT" --enable-lora --max-lora-rank ${Math.trunc(opts.maxLoraRank)} --lora-modules ${loraModules} > vllm.log 2>&1 &
echo $! > vllm.pid
say "[vllm] waiting for the server to answer (the first start loads the model)"
until curl -sf -H "Authorization: Bearer $VLLM_API_KEY" "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
  kill -0 "$(cat vllm.pid)" 2>/dev/null || fail 1 'vllm exited before it was ready; see the vllm log'
  sleep 5
done
say "[vllm] ready"
URL=""
  ${tunnelStart}
[ -n "$URL" ] || fail 1 'the tunnel did not report a public url'
printf '%s' "$URL" > url.tmp && mv -f url.tmp url
touch ready
say "[tunnel] public url ready"
wait "$(cat vllm.pid)"
CODE=$?
printf '{"code":%s,"message":"vllm exited"}' "$CODE" > exit.tmp && mv -f exit.tmp exit
`;
}

export function buildServeLaunchCommand(dir: string): string {
	// stdin, stdout and stderr are detached so the exec returns at once with the pid
	return `setsid nohup bash ${shq(`${dir}/run.sh`)} </dev/null >/dev/null 2>&1 & echo "$!"`;
}

export function buildServeProbeCommand(dir: string, pid: number): string {
	const d = shq(dir);
	const p = String(Math.trunc(pid));
	return `D=${d}; echo '@@EXIT@@'; cat "$D/exit" 2>/dev/null; echo; echo '@@HB@@'; cat "$D/heartbeat" 2>/dev/null; echo; echo '@@PID@@'; if kill -0 ${p} 2>/dev/null; then echo ALIVE; fi; echo '@@READY@@'; [ -f "$D/ready" ] && echo yes; echo '@@URL@@'; cat "$D/url" 2>/dev/null; echo; echo '@@LOG@@'; tail -c 2000 "$D/serve.log" 2>/dev/null; echo; tail -c 2500 "$D/vllm.log" 2>/dev/null; echo; echo '@@END@@'`;
}

// stops the whole process group (the script, vllm and the tunnel) and removes the directory,
// which holds the env file with the key and tokens
export function buildServeStopCommand(dir: string, pgid: number): string {
	if (!dir.startsWith(`${SERVE_ROOT}/`))
		throw new Error('refusing to remove a path outside the serve root');
	const g = String(Math.trunc(pgid));
	return `kill -TERM -- -${g} 2>/dev/null; sleep 2; kill -KILL -- -${g} 2>/dev/null; rm -rf ${shq(dir)}; echo done`;
}

export type ServeProbe = {
	exit: { code: number; message: string } | null;
	pidAlive: boolean;
	heartbeatEpoch: number | null;
	ready: boolean;
	url: string | null;
	logTail: string;
};

export function parseServeProbe(stdout: string): ServeProbe {
	const section = (name: string): string => {
		const start = stdout.indexOf(`@@${name}@@`);
		if (start < 0) return '';
		const from = start + name.length + 4;
		const next = stdout.indexOf('@@', from);
		return stdout.slice(from, next < 0 ? undefined : next).trim();
	};
	let exit: ServeProbe['exit'] = null;
	const exitRaw = section('EXIT');
	if (exitRaw) {
		try {
			const parsed = JSON.parse(exitRaw) as { code?: number; message?: string };
			exit = { code: Number(parsed.code ?? 1), message: String(parsed.message ?? 'exited') };
		} catch {
			exit = { code: 1, message: 'exited' };
		}
	}
	const hb = Number.parseInt(section('HB'), 10);
	const url = section('URL');
	return {
		exit,
		pidAlive: section('PID').includes('ALIVE'),
		heartbeatEpoch: Number.isFinite(hb) ? hb : null,
		ready: section('READY') === 'yes',
		url: /^https:\/\/[^\s]+$/.test(url) ? url : null,
		logTail: section('LOG')
	};
}

// #region remote calls

function mockScenario(host: string): 'success' | 'fail' {
	return host.startsWith('mock-fail') ? 'fail' : 'success';
}

async function mockPolls(id: string, set?: number): Promise<number> {
	const key = `mylora:mockserve:${id}`;
	if (set !== undefined) {
		await kv.set(key, set);
		return set;
	}
	return (await kv.get<number>(key)) ?? 0;
}

export async function provisionServe(opts: {
	creds: RemoteCreds;
	id: string;
	script: string;
	env: string;
	adapters: ServeAdapterFile[];
}): Promise<{ pid: number }> {
	const dir = serveDirFor(opts.id);
	if (isMockSsh()) {
		await mockPolls(opts.id, 0);
		return { pid: 5151 };
	}
	const { ssh, sftp } = await edge();
	const session = await ssh.connect(connectOpts(opts.creds));
	try {
		// a 700 directory first, so nothing written into it is readable by other users on the box
		await session.exec(`umask 077; mkdir -p ${shq(`${dir}/adapters`)}`);
		const fs = await sftp.connect({ session });
		try {
			const enc = new TextEncoder();
			await fs.writeFile(`${dir}/env`, enc.encode(opts.env));
			await fs.chmod(`${dir}/env`, 0o600);
			await fs.writeFile(`${dir}/run.sh`, enc.encode(opts.script));
			for (const a of opts.adapters) {
				if (!MODEL_NAME_RE.test(a.name)) throw new Error(`invalid adapter name: ${a.name}`);
				await fs.ensureDir(`${dir}/adapters/${a.name}`);
				if (a.config) {
					await fs.writeFile(
						`${dir}/adapters/${a.name}/adapter_config.json`,
						new Uint8Array(await a.config.arrayBuffer())
					);
				}
				// weights can be hundreds of MB, so they stream instead of being buffered in the worker
				await a.weights
					.stream()
					.pipeTo(fs.createWriteStream(`${dir}/adapters/${a.name}/adapter_model.safetensors`));
			}
		} finally {
			await fs.close().catch(() => {});
		}
		const { stdout } = await session.exec(buildServeLaunchCommand(dir));
		const pid = parseInt(new TextDecoder().decode(stdout).trim(), 10);
		if (!Number.isFinite(pid)) throw new Error('failed to read the launched PID');
		return { pid };
	} finally {
		await session.close().catch(() => {});
	}
}

export type ServeProbeOutcome = { parsed: ServeProbe } | { connError: ConnectionDiagnosis };

export async function probeServe(
	creds: RemoteCreds,
	id: string,
	pid: number
): Promise<ServeProbeOutcome> {
	const dir = serveDirFor(id);
	if (isMockSsh()) {
		const polls = (await mockPolls(id)) + 1;
		await mockPolls(id, polls);
		const now = Math.floor(Date.now() / 1000);
		const base = { pidAlive: true, heartbeatEpoch: now };
		if (polls < 2) {
			return {
				parsed: {
					...base,
					exit: null,
					ready: false,
					url: null,
					logTail: '[mock] downloading the model\n'
				}
			};
		}
		if (mockScenario(creds.hostname) === 'fail') {
			return {
				parsed: {
					pidAlive: false,
					heartbeatEpoch: now - 600,
					exit: { code: 1, message: 'vllm exited before it was ready; see the vllm log' },
					ready: false,
					url: null,
					logTail: '[mock] CUDA out of memory\n'
				}
			};
		}
		return {
			parsed: {
				...base,
				exit: null,
				ready: true,
				url: `https://mock-vllm-${id.slice(0, 8)}.example.test`,
				logTail: '[mock] serving\n'
			}
		};
	}
	const { ssh } = await edge();
	try {
		const { stdout } = await ssh.exec({
			...connectOpts(creds),
			command: buildServeProbeCommand(dir, pid)
		});
		return { parsed: parseServeProbe(new TextDecoder().decode(stdout)) };
	} catch (err) {
		return { connError: classifyError(err) };
	}
}

export async function stopServeRemote(creds: RemoteCreds, id: string, pgid: number): Promise<void> {
	if (isMockSsh()) return;
	const { ssh } = await edge();
	await ssh
		.exec({ ...connectOpts(creds), command: buildServeStopCommand(serveDirFor(id), pgid) })
		.catch(() => {});
}

// #endregion
