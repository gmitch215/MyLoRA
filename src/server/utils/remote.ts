import {
	buildAbortCommand,
	buildLaunchCommand,
	buildPreflightCommand,
	buildPrepareLaunchCommand,
	buildPrepareScript,
	buildProbeCommand,
	buildRunScript,
	hasAdapterConfig,
	jobDirFor,
	outputWeightsName,
	parsePreflightOutput,
	parseProbeOutput,
	redactSecrets,
	shq,
	TRAIN_PEFT_PY,
	type Doc2LoraExtras,
	type PreflightResult,
	type ProbeParsed,
	type RemoteTrainingConfig,
	type TrainingEngineName
} from './remote-commands';

export type RemoteCreds = {
	hostname: string;
	port: number;
	username: string;
	password?: string;
	privateKey?: { pem: string; passphrase?: string };
	expectFingerprint?: string | null;
};

// edgeport's host-key verifier receives (type, rawKey); we pin to a captured fingerprint
type CapturedHostKey = { type: string; fingerprint: string };

export function isMockSsh(): boolean {
	if (process.env.NODE_ENV === 'production') return false;
	if (process.env.MYLORA_MOCK_SSH === '1') return true;
	// piggyback on the existing cf mock so dev:test (MYLORA_MOCK_CF=1) auto-mocks ssh too
	try {
		return !!useRuntimeConfig().mockCf;
	} catch {
		return process.env.MYLORA_MOCK_CF === '1';
	}
}

function b64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function fingerprintOf(key: Uint8Array<ArrayBuffer>): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', key));
	return `SHA256:${b64(d).replace(/=+$/, '')}`;
}

// encode an ssh wire string (uint32 length prefix + bytes)
function sshString(bytes: Uint8Array): Uint8Array {
	const out = new Uint8Array(4 + bytes.length);
	new DataView(out.buffer).setUint32(0, bytes.length, false);
	out.set(bytes, 4);
	return out;
}

// generate an ed25519 keypair: pkcs8 pem private + an openssh public line to install
export async function generateKeypair(): Promise<{
	privateKeyPem: string;
	publicKey: string;
	last4: string;
}> {
	const pair = (await crypto.subtle.generateKey('Ed25519', true, [
		'sign',
		'verify'
	])) as CryptoKeyPair;
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
	const b64key = b64(pkcs8);
	const pem = `-----BEGIN PRIVATE KEY-----\n${b64key.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
	const typeBytes = new TextEncoder().encode('ssh-ed25519');
	const blob = new Uint8Array([...sshString(typeBytes), ...sshString(raw)]);
	const publicKey = `ssh-ed25519 ${b64(blob)} mylora`;
	return { privateKeyPem: pem, publicKey, last4: b64(raw).slice(-4) };
}

function diag(
	code: ConnectionDiagnosis['code'],
	message: string,
	extra?: Partial<ConnectionDiagnosis>
): ConnectionDiagnosis {
	return { ok: code === 'ok', code, message, ...extra };
}

// map an edgeport error to a specific user-facing diagnosis
function classifyError(err: unknown): ConnectionDiagnosis {
	const name = (err as { name?: string })?.name ?? '';
	const msg = ((err as { message?: string })?.message ?? String(err)).toLowerCase();
	if (name === 'AuthError' || /auth|publickey|password|permission denied/.test(msg))
		return diag('auth', 'Authentication rejected; check the username and key/password.');
	if (name === 'TimeoutError' || /timeout|timed out/.test(msg))
		return diag('timeout', 'Connection timed out; the host may be down or the port blocked.');
	if (/getaddrinfo|dns|enotfound|name not known|resolve/.test(msg))
		return diag('dns', 'Host could not be resolved (DNS). Check the host address.');
	if (/refused|econnrefused|connect/.test(msg))
		return diag('refused', 'Connection refused; verify the port and that SSH is running.');
	if (name === 'ProtocolError' || /protocol|cipher|kex|host key/.test(msg))
		return diag('protocol', `SSH negotiation failed: ${(err as Error)?.message ?? msg}`);
	return diag('unknown', (err as Error)?.message ?? 'Unknown connection error.');
}

// ----- mock state (KV-backed so it survives across poll requests under nuxi dev) -----

type MockScenario = 'success' | 'fail' | 'abnormal' | 'gated';

function mockScenarioFor(hostname: string): MockScenario {
	if (hostname.startsWith('mock-gated')) return 'gated';
	if (hostname.startsWith('mock-fail')) return 'fail';
	if (hostname.startsWith('mock-abnormal')) return 'abnormal';
	return 'success';
}

// a realistic HF gated/401 stderr the classifier must recognize (mock-gated scenario)
const MOCK_GATED_LOG = `Traceback (most recent call last):
huggingface_hub.errors.GatedRepoError: 401 Client Error. Cannot access gated repo for url https://huggingface.co/meta-llama/Llama-2-7b-chat-hf/resolve/main/config.json.
Access to model meta-llama/Llama-2-7b-chat-hf is restricted. You must have access to it and be authenticated to access it. Please log in.\n`;

const MOCK_WEIGHTS = new TextEncoder().encode('MOCK_SAFETENSORS_v1');
const MOCK_CONFIG = JSON.stringify({ r: 8, lora_alpha: 16, target_modules: ['q_proj', 'v_proj'] });

async function mockState(jobId: string) {
	const key = `mylora:mockjob:${jobId}`;
	const cur = (await kv.get<{ polls: number; scenario: MockScenario }>(key)) ?? null;
	return {
		key,
		get: cur,
		async set(v: { polls: number; scenario: MockScenario }) {
			await kv.set(key, v);
		}
	};
}

async function edge() {
	const ssh = await import('edgeport/ssh');
	const sftp = await import('edgeport/sftp');
	return { ssh, sftp };
}

function hostKeyVerifier(creds: RemoteCreds, captured: { value: CapturedHostKey | null }) {
	return {
		async verify(type: string, key: Uint8Array<ArrayBuffer>): Promise<boolean> {
			const fp = await fingerprintOf(key);
			captured.value = { type, fingerprint: fp };
			// pin if we already know the fingerprint (flag man-in-the-middle on change)
			if (creds.expectFingerprint) return creds.expectFingerprint === fp;
			return true; // tofu on first contact
		}
	};
}

export async function testConnection(creds: RemoteCreds): Promise<ConnectionDiagnosis> {
	if (isMockSsh()) {
		const h = creds.hostname;
		if (h.startsWith('mock-unreachable')) return diag('refused', 'Connection refused (mock).');
		if (h.startsWith('mock-dns')) return diag('dns', 'Host not found (mock).');
		if (h.startsWith('mock-auth')) return diag('auth', 'Authentication rejected (mock).');
		if (h.startsWith('mock-timeout')) return diag('timeout', 'Timed out (mock).');
		if (creds.expectFingerprint && creds.expectFingerprint !== 'SHA256:mockfingerprint')
			return diag('host_key_changed', 'Host key changed since last connection (mock).');
		const pre = await preflight(creds);
		return diag('ok', 'Connected, authenticated, and ran a command.', {
			gpuInfo: pre.gpu,
			systemInfo: pre.system,
			toolingReady: pre.pythonOk && pre.pipOk,
			hostKeyFingerprint: 'SHA256:mockfingerprint'
		});
	}
	const { ssh } = await edge();
	const captured: { value: CapturedHostKey | null } = { value: null };
	try {
		const session = await ssh.connect({
			...connectOpts(creds),
			hostKey: hostKeyVerifier(creds, captured)
		});
		try {
			await session.exec('true');
		} finally {
			await session.close().catch(() => {});
		}
		const pre = await preflight(creds);
		return diag('ok', 'Connected, authenticated, and ran a command.', {
			gpuInfo: pre.gpu,
			systemInfo: pre.system,
			toolingReady: pre.pythonOk && pre.pipOk,
			hostKeyFingerprint: captured.value?.fingerprint ?? null
		});
	} catch (err) {
		const d = classifyError(err);
		if (
			creds.expectFingerprint &&
			captured.value &&
			captured.value.fingerprint !== creds.expectFingerprint
		)
			return diag('host_key_changed', 'Host key changed since last connection.');
		return d;
	}
}

function connectOpts(creds: RemoteCreds) {
	return {
		hostname: creds.hostname,
		port: creds.port,
		username: creds.username,
		password: creds.password,
		privateKey: creds.privateKey,
		timeoutMs: 15000,
		// prefer hardware-paced aes-gcm over pure-js chacha for large transfers
		algorithms: { cipher: ['aes256-gcm@openssh.com', 'aes128-gcm@openssh.com'] }
	};
}

export async function preflight(creds: RemoteCreds): Promise<PreflightResult> {
	if (isMockSsh()) {
		// a deterministic system snapshot for the e2e/dev view (host prefix tweaks gpu fields)
		const mockSystem = (gpus: GpuInfo[]): SystemInfo => ({
			hostname: 'mock-box',
			os: 'Ubuntu 24.04.1 LTS',
			kernel: '6.8.0-mock',
			user: creds.username,
			cpuModel: 'Mock Ryzen 9 7950X 16-Core',
			cpuCores: 16,
			ramTotalMb: 64000,
			ramAvailMb: 48000,
			diskTotalGb: 500,
			diskAvailGb: 320,
			diskType: 'SSD',
			gpus,
			// mock-hfenv pretends the box already exports a token (drives the "token detected" infographic)
			hfTokenEnv: creds.hostname.startsWith('mock-hfenv')
				? ['HF_API_KEY', 'HUGGINGFACE_API_TOKEN']
				: null
		});
		if (creds.hostname.startsWith('mock-nogpu'))
			return {
				gpu: null,
				pythonVersion: '3.11',
				pythonOk: true,
				pipOk: true,
				sudo: false,
				system: mockSystem([])
			};
		if (creds.hostname.startsWith('mock-lowvram')) {
			const gpu: GpuInfo = { name: 'Mock RTX 4070', vramMb: 12000, vramUsedMb: 1000 };
			return {
				gpu,
				pythonVersion: '3.11',
				pythonOk: true,
				pipOk: true,
				sudo: false,
				system: mockSystem([gpu])
			};
		}
		// mock-atcap reports VRAM >= 80% used (for the At Capacity health)
		const usedMb = creds.hostname.startsWith('mock-atcap') ? 21000 : 3000;
		const gpu: GpuInfo = { name: 'Mock RTX 4090', vramMb: 24000, vramUsedMb: usedMb };
		return {
			gpu,
			pythonVersion: '3.11',
			pythonOk: true,
			pipOk: true,
			sudo: false,
			system: mockSystem([gpu])
		};
	}
	const { ssh } = await edge();
	const { stdout } = await ssh.exec({ ...connectOpts(creds), command: buildPreflightCommand() });
	return parsePreflightOutput(new TextDecoder().decode(stdout));
}

export async function provisionAndLaunch(opts: {
	creds: RemoteCreds;
	jobId: string;
	engine: TrainingEngineName;
	config: RemoteTrainingConfig;
	// doc2lora: the uploaded document/dataset files to drop into the box input dir (peft uses none -
	// it loads its dataset from huggingface on the box)
	files?: { name: string; bytes: Uint8Array }[];
	hfToken?: string | null;
	// ephemeral sudo creds injected into the launched process env (never written to disk)
	sudoPassword?: string | null;
	sudoUser?: string | null;
	// 1-based attempt number, stamped as a banner in the box's train.log
	attempt?: number;
	// username that launched the job, stamped into train.log for attribution
	requestedBy?: string | null;
}): Promise<{ pid: number; pgid: number; wrapperId: string }> {
	const jobDir = jobDirFor(opts.jobId);
	const wrapperId = crypto.randomUUID();
	if (isMockSsh()) {
		const st = await mockState(opts.jobId);
		await st.set({ polls: 0, scenario: mockScenarioFor(opts.creds.hostname) });
		return { pid: 4242, pgid: 4242, wrapperId };
	}
	const { ssh, sftp } = await edge();
	// ONE connection for the whole launch: reuse the session for sftp + the launch exec (edgeport 1.0.2
	// fixed the channel-reuse bug that previously forced separate connections), and create the dirs over
	// sftp with ensureDir (mkdir -p) instead of a separate exec. one handshake, minimal box load.
	const session = await ssh.connect(connectOpts(opts.creds));
	try {
		const enc = new TextEncoder();
		const fs = await sftp.connect({ session });
		try {
			await fs.ensureDir(`${jobDir}/input`);
			await fs.ensureDir(`${jobDir}/out`);
			await fs.writeFile(
				`${jobDir}/run.sh`,
				enc.encode(
					buildRunScript({
						jobDir,
						engine: opts.engine,
						config: opts.config,
						hfToken: opts.hfToken,
						attempt: opts.attempt,
						requestedBy: opts.requestedBy
					})
				)
			);
			if (opts.engine === 'peft') {
				// peft loads its dataset from huggingface; we only push the generated training script
				await fs.writeFile(`${jobDir}/train_peft.py`, enc.encode(TRAIN_PEFT_PY));
			} else if (opts.engine === 'accelerate') {
				// accelerate loads from huggingface + the run script fetches the diffusers script; nothing to push
			} else {
				// doc2lora parses the input directory (handles many files + archives natively)
				for (const f of opts.files ?? []) {
					await fs.writeFile(`${jobDir}/input/${sanitizeName(f.name)}`, f.bytes);
				}
			}
		} finally {
			await fs.close().catch(() => {});
		}

		// launch the detached run on the SAME session (returns immediately with the pid)
		const { stdout } = await session.exec(
			buildLaunchCommand(jobDir, opts.sudoPassword, opts.sudoUser)
		);
		const pid = parseInt(new TextDecoder().decode(stdout).trim(), 10);
		if (!Number.isFinite(pid)) throw new Error('failed to read launched PID');
		return { pid, pgid: pid, wrapperId };
	} finally {
		await session.close().catch(() => {});
	}
}

// keep an uploaded filename safe as a single path segment on the box
function sanitizeName(name: string): string {
	const base = (name || 'file').split('/').pop() || 'file';
	return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'file';
}

export type ProbeOutcome = { parsed: ProbeParsed } | { connError: ConnectionDiagnosis };

export async function probe(creds: RemoteCreds, jobId: string, pid: number): Promise<ProbeOutcome> {
	const jobDir = jobDirFor(jobId);
	if (isMockSsh()) {
		const st = await mockState(jobId);
		const cur = st.get ?? { polls: 0, scenario: mockScenarioFor(creds.hostname) };
		const polls = cur.polls + 1;
		await st.set({ ...cur, polls });
		const now = Math.floor(Date.now() / 1000);
		const mockLog = `[mock] training step ${polls}/...\n`;
		const mockTel: JobTelemetry = {
			cpuPct: 42,
			ramUsedMb: 18000,
			ramTotalMb: 64000,
			gpuUtilPct: 88,
			vramUsedMb: 9000,
			vramTotalMb: 24000,
			diskAvailGb: 300,
			netRxMb: 1200,
			netTxMb: 40,
			outputBytes: 26_000_000
		};
		// first probe is always a live "still running" tick (no sentinel yet) so the running branch in
		// pollRunning persists a telemetry sample before the scenario resolves on the next probe
		if (polls < 2)
			return {
				parsed: {
					sentinel: null,
					heartbeatEpoch: now,
					pidAlive: true,
					cmdline: jobDir,
					logTail: mockLog,
					telemetry: mockTel
				}
			};
		if (cur.scenario === 'success') {
			const sha = await sha256Hex(MOCK_WEIGHTS);
			return {
				parsed: {
					sentinel: { status: 'success', sha256: sha, size: MOCK_WEIGHTS.length },
					heartbeatEpoch: now,
					pidAlive: false,
					cmdline: '',
					logTail: `${mockLog}[mock] training complete\n`,
					telemetry: mockTel
				}
			};
		}
		if (cur.scenario === 'fail')
			return {
				parsed: {
					sentinel: { status: 'failed', exitCode: 1 },
					heartbeatEpoch: now,
					pidAlive: false,
					cmdline: '',
					logTail: `${mockLog}[mock] training failed\n`,
					telemetry: mockTel
				}
			};
		// gated: a reported failure whose log carries the HF 401 signature (-> 'gated' failure class)
		if (cur.scenario === 'gated')
			return {
				parsed: {
					sentinel: { status: 'failed', exitCode: 1 },
					heartbeatEpoch: now,
					pidAlive: false,
					cmdline: '',
					logTail: `${mockLog}${MOCK_GATED_LOG}`,
					telemetry: mockTel
				}
			};
		// abnormal: sentinel never appears, pid is gone
		return {
			parsed: {
				sentinel: null,
				heartbeatEpoch: now - 600,
				pidAlive: false,
				cmdline: '',
				logTail: mockLog,
				telemetry: null
			}
		};
	}
	const { ssh } = await edge();
	try {
		const { stdout } = await ssh.exec({
			...connectOpts(creds),
			command: buildProbeCommand(jobDir, pid)
		});
		return { parsed: parseProbeOutput(new TextDecoder().decode(stdout), jobDir) };
	} catch (err) {
		return { connError: classifyError(err) };
	}
}

// pull the trained adapter; returns the (optional) config bytes and a streaming reader for the
// weights. the output filename + presence of an adapter_config.json depend on the engine.
export async function pullAdapter(
	creds: RemoteCreds,
	jobId: string,
	engine: TrainingEngineName
): Promise<{ configBytes: Uint8Array | null; weights: ReadableStream<Uint8Array>; size: number }> {
	const jobDir = jobDirFor(jobId);
	const wname = outputWeightsName(engine);
	if (isMockSsh()) {
		const weights = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(MOCK_WEIGHTS);
				c.close();
			}
		});
		return {
			configBytes: hasAdapterConfig(engine) ? new TextEncoder().encode(MOCK_CONFIG) : null,
			weights,
			size: MOCK_WEIGHTS.length
		};
	}
	const { sftp } = await edge();
	const fs = await sftp.connect(connectOpts(creds));
	const configBytes = hasAdapterConfig(engine)
		? await fs.readFile(`${jobDir}/out/adapter_config.json`).catch(() => null)
		: null;
	const attrs = await fs.stat(`${jobDir}/out/${wname}`);
	// the read stream closes the sftp session when fully consumed
	const inner = fs.createReadStream(`${jobDir}/out/${wname}`);
	const weights = new ReadableStream<Uint8Array>({
		async start(controller) {
			const reader = inner.getReader();
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					if (value) controller.enqueue(value);
				}
				controller.close();
			} catch (e) {
				controller.error(e);
			} finally {
				await fs.close().catch(() => {});
			}
		}
	});
	return { configBytes, weights, size: attrs.size ?? 0 };
}

export async function abort(
	creds: RemoteCreds,
	jobId: string,
	pgid: number,
	opts?: { useSudo?: boolean; sudoPassword?: string | null }
): Promise<void> {
	if (isMockSsh()) return;
	const { ssh } = await edge();
	await ssh
		.exec({ ...connectOpts(creds), command: buildAbortCommand(jobDirFor(jobId), pgid, opts) })
		.catch(() => {});
}

// kick off a detached machine-prepare: build a persistent ~/.mylora venv that warms uv's wheel cache
// so training-job venvs install instantly, and write a prepared.json marker. returns immediately.
export async function prepareMachine(
	creds: RemoteCreds,
	opts: { doc2loraExtras: Doc2LoraExtras; load4bit: boolean; pythonVersion?: string | null }
): Promise<void> {
	if (isMockSsh()) return;
	const { ssh, sftp } = await edge();
	const session = await ssh.connect(connectOpts(creds));
	try {
		const fs = await sftp.connect({ session });
		try {
			await fs.ensureDir('.mylora');
			await fs.writeFile('.mylora/prepare.sh', new TextEncoder().encode(buildPrepareScript(opts)));
		} finally {
			await fs.close().catch(() => {});
		}
		await session.exec(buildPrepareLaunchCommand());
	} finally {
		await session.close().catch(() => {});
	}
}

// fetch the full remote train.log (for the live modal stream + the persisted copy on completion).
// best-effort: an unreachable box / missing file yields an empty string rather than throwing.
export async function fetchRemoteLog(creds: RemoteCreds, jobId: string): Promise<string> {
	const jobDir = jobDirFor(jobId);
	if (isMockSsh()) {
		const st = await mockState(jobId);
		const polls = st.get?.polls ?? 0;
		const gated = st.get?.scenario === 'gated' ? MOCK_GATED_LOG : '';
		return `[mock] full training log for ${jobId}\n[mock] progress 50%|#####     | ${polls}/2 [00:05<00:05,  1.00it/s]\n${gated}`;
	}
	try {
		const { ssh } = await edge();
		const { stdout } = await ssh.exec({
			...connectOpts(creds),
			command: `cat ${shq(jobDir)}/train.log 2>/dev/null`
		});
		// scrub any token that leaked into tool output before it is persisted to R2 / shown in the UI
		return redactSecrets(new TextDecoder().decode(stdout));
	} catch {
		return '';
	}
}
