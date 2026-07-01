import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import type { Machine, TrainingJob } from 'hub:db:schema';
import { adapters, cloudflareAccounts, machines, trainingJobs, users } from 'hub:db:schema';
import { kv } from 'hub:kv';
import {
	fetchRemoteLog,
	isMockSsh,
	preflight,
	probe,
	provisionAndLaunch,
	pullAdapter,
	abort as remoteAbort,
	type RemoteCreds
} from './remote';
import { classifyTrainingFailure, tuneConfigForVram } from './remote-commands';

// transient sudo-credential custody
const SUDO_PW_TTL_S = 900;
const sudoPwKey = (jobId: string) => `mylora:sudopw:${jobId}`;
type SudoCreds = { user?: string; password?: string };

export async function stashSudoCreds(jobId: string, creds: SudoCreds): Promise<void> {
	if (!creds.user && !creds.password) return;
	await assertEncryptionKey();
	await kv.set(sudoPwKey(jobId), await encryptSecret(JSON.stringify(creds)), {
		ttl: SUDO_PW_TTL_S
	});
}

// read + delete the stashed sudo creds (single use)
async function takeSudoCreds(jobId: string): Promise<SudoCreds | null> {
	const key = sudoPwKey(jobId);
	const enc = await kv
		.get<{ cipher: string; iv: string; dekCipher: string; dekIv: string }>(key)
		.catch(() => null);
	if (!enc) return null;
	try {
		const creds = JSON.parse(await decryptSecret(enc)) as SudoCreds;
		await kv.del(key).catch(() => {});
		return creds;
	} catch {
		await kv.del(key).catch(() => {});
		return null;
	}
}

export async function clearSudoPassword(jobId: string): Promise<void> {
	await kv.del(sudoPwKey(jobId)).catch(() => {});
}

// snapshot the full remote train.log into R2 (jobs/<id>/train.log) so it survives the box being wiped;
// best-effort (an unreachable box yields nothing). returns the captured text for an immediate response
async function persistJobLog(jobId: string, creds: RemoteCreds): Promise<string> {
	try {
		const text = await fetchRemoteLog(creds, jobId);
		if (text) {
			await blob.put(`jobs/${jobId}/train.log`, new TextEncoder().encode(text), {
				contentType: 'text/plain; charset=utf-8'
			});
		}
		return text;
	} catch {
		return '';
	}
}

// purge persisted R2 training logs for jobs that finished longer ago than the retention window (the
// `logRetentionDays` setting). throttled by a KV timestamp so it runs at most a few times a day even
// though the cron calls in every minute. returns the number of logs deleted.
const LOG_PURGE_KEY = 'mylora:logpurge:last';
const LOG_PURGE_EVERY_MS = 6 * 60 * 60_000;

export async function purgeExpiredLogs(force = false): Promise<number> {
	try {
		if (!force) {
			const last = Number((await kv.get<string>(LOG_PURGE_KEY)) ?? 0);
			if (last && Date.now() - last < LOG_PURGE_EVERY_MS) return 0;
		}
		await kv.set(LOG_PURGE_KEY, String(Date.now()));
		const limits = await getLimits();
		const days = Math.max(7, Math.min(365, limits.logRetentionDays ?? 90));
		const cutoff = new Date(Date.now() - days * 86_400_000);
		const old = await db
			.select({ id: trainingJobs.id })
			.from(trainingJobs)
			.where(
				and(
					inArray(trainingJobs.status, ['completed', 'failed', 'abnormal', 'aborted']),
					lt(trainingJobs.finishedAt, cutoff)
				)
			);
		let purged = 0;
		for (const j of old) {
			const key = `jobs/${j.id}/train.log`;
			try {
				if (await blob.get(key)) {
					await blob.del(key);
					purged++;
				}
			} catch {
				// best-effort
			}
		}
		return purged;
	} catch {
		return 0;
	}
}

export const POLL_INTERVAL_MS = 30_000;
export const POLL_FAST_MS = 10_000;
export const ABNORMAL_THRESHOLD = 3;
// a heartbeat older than this means the run is not actually progressing
export const HEARTBEAT_STALE_MS = 120_000;
// only re-claim a job stuck in 'provisioning' (a crashed launch, no pid) after this long, so a normal
// slow launch (cold dependency download) is never double-launched
export const LAUNCH_STALL_MS = 15 * 60_000;
// minimum gap between actual SSH probes of a running job, regardless of how often a driver calls in
export const MIN_PROBE_INTERVAL_MS = 8_000;
// advisory lease duration: one driver owns a job for at most this long per step. covers the slowest step
// (the adapter pull); if a worker dies mid-step the lease expires and another driver reclaims the job
export const LEASE_MS = 4 * 60_000;

function changed(res: unknown): number {
	const r = res as Record<string, unknown> & { meta?: Record<string, unknown> };
	return Number(r?.rowsAffected ?? r?.meta?.changes ?? r?.changes ?? 0);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ----- redaction + serialization -----

export function redactMachine(row: Machine): PublicMachine {
	return {
		id: row.id,
		label: row.label,
		ownerId: row.ownerId,
		shared: row.shared,
		host: row.host,
		port: row.port,
		username: row.username,
		authMethod: row.authMethod,
		connectionType: row.connectionType,
		keySource: row.keySource,
		publicKey: row.publicKey,
		keyLast4: row.keyLast4,
		hostKeyFingerprint: row.hostKeyFingerprint,
		hostKeyType: row.hostKeyType,
		healthStatus: row.healthStatus,
		lastDiagnosis: row.lastDiagnosis,
		lastCheckedAt: row.lastCheckedAt ? new Date(row.lastCheckedAt).toISOString() : null,
		gpuInfo: row.gpuInfo ? safeJson<GpuInfo>(row.gpuInfo) : null,
		systemInfo: row.systemInfo ? safeJson<SystemInfo>(row.systemInfo) : null,
		toolingReady: row.toolingReady,
		hasSelfReport: !!row.selfReportTokenHash,
		isActive: row.isActive,
		createdAt: new Date(row.createdAt).toISOString(),
		updatedAt: new Date(row.updatedAt).toISOString()
	};
}

// map a connection diagnosis onto the machine health columns (reused by create + test)
export function diagnosisToMachineUpdate(diag: ConnectionDiagnosis): Record<string, unknown> {
	const healthStatus: MachineHealth =
		diag.code === 'ok'
			? 'ok'
			: diag.code === 'auth'
				? 'auth_failed'
				: diag.code === 'dns' || diag.code === 'refused' || diag.code === 'timeout'
					? 'unreachable'
					: 'degraded';
	const update: Record<string, unknown> = {
		healthStatus,
		lastDiagnosis: diag.message.slice(0, 300),
		lastCheckedAt: new Date(),
		updatedAt: new Date()
	};
	if (diag.hostKeyFingerprint) update.hostKeyFingerprint = diag.hostKeyFingerprint;
	if (diag.gpuInfo) update.gpuInfo = JSON.stringify(diag.gpuInfo);
	if (diag.systemInfo) update.systemInfo = JSON.stringify(diag.systemInfo);
	if (typeof diag.toolingReady === 'boolean') update.toolingReady = diag.toolingReady;
	return update;
}

export async function hashSelfReportToken(token: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
	return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function safeJson<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

// carry the first sample's net counters forward as a baseline so the run's own bandwidth = current -
// baseline (the raw counters are box-wide cumulative, useless without a per-run zero point)
function withNetBaseline(sample: JobTelemetry, priorJson: string | null): JobTelemetry {
	const prior = priorJson ? safeJson<JobTelemetry>(priorJson) : null;
	return {
		...sample,
		netRxMb0: prior?.netRxMb0 ?? sample.netRxMb ?? null,
		netTxMb0: prior?.netTxMb0 ?? sample.netTxMb ?? null
	};
}

// fetch all uploaded doc2lora files for a dataset (many objects under datasets/<id>/, with a
// fallback to the legacy single-key layout)
async function loadDatasetFiles(datasetId: string): Promise<{ name: string; bytes: Uint8Array }[]> {
	const out: { name: string; bytes: Uint8Array }[] = [];
	try {
		const listed = (await blob.list({ prefix: `datasets/${datasetId}/`, limit: 1000 })) as {
			blobs?: { pathname: string }[];
		};
		for (const b of listed?.blobs ?? []) {
			const obj = await blob.get(b.pathname);
			if (obj)
				out.push({
					name: b.pathname.split('/').pop() || 'file',
					bytes: new Uint8Array(await obj.arrayBuffer())
				});
		}
	} catch {
		// fall through to the single-key layout
	}
	if (out.length) return out;
	const obj = await blob.get(`datasets/${datasetId}`);
	if (obj) out.push({ name: 'documents.bin', bytes: new Uint8Array(await obj.arrayBuffer()) });
	return out;
}

async function decryptJobHfToken(job: TrainingJob): Promise<string | null> {
	if (job.hfTokenCipher && job.hfTokenIv && job.hfTokenDekCipher && job.hfTokenDekIv) {
		try {
			return await decryptSecret({
				cipher: job.hfTokenCipher,
				iv: job.hfTokenIv,
				dekCipher: job.hfTokenDekCipher,
				dekIv: job.hfTokenDekIv
			});
		} catch {
			return null;
		}
	}
	return null;
}

export function serializeJob(row: TrainingJob, machineLabel?: string | null): TrainingJobView {
	const config = (safeJson<TrainingConfigView>(row.config) ?? {}) as TrainingConfigView;
	return {
		id: row.id,
		machineId: row.machineId,
		machineLabel: machineLabel ?? null,
		authorId: row.authorId,
		engine: row.engine,
		status: row.status,
		statusMessage: row.statusMessage,
		failureClass: row.failureClass,
		datasetId: row.datasetId,
		inputKind: row.inputKind,
		config,
		autoPublish: row.autoPublish,
		autoUploadFinetune: row.autoUploadFinetune,
		accountId: row.accountId,
		startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
		finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
		lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
		consecutiveFailures: row.consecutiveFailures,
		attempt: row.attempt,
		logTail: row.logTail,
		adapterId: row.adapterId,
		adapterSize: row.adapterSize,
		etaSeconds: row.etaSeconds,
		downloadOnly: row.downloadOnly,
		telemetry: row.telemetry ? safeJson<JobTelemetry>(row.telemetry) : null,
		createdAt: new Date(row.createdAt).toISOString(),
		updatedAt: new Date(row.updatedAt).toISOString()
	};
}

// ----- credentials + access -----

export async function resolveMachineCreds(machine: Machine): Promise<RemoteCreds> {
	const creds: RemoteCreds = {
		hostname: machine.host,
		port: machine.port,
		username: machine.username,
		expectFingerprint: machine.hostKeyFingerprint
	};
	if (machine.authMethod === 'password') {
		if (
			machine.passwordCipher &&
			machine.passwordIv &&
			machine.passwordDekCipher &&
			machine.passwordDekIv
		) {
			creds.password = await decryptSecret({
				cipher: machine.passwordCipher,
				iv: machine.passwordIv,
				dekCipher: machine.passwordDekCipher,
				dekIv: machine.passwordDekIv
			});
		}
	} else if (machine.keyCipher && machine.keyIv && machine.keyDekCipher && machine.keyDekIv) {
		const pem = await decryptSecret({
			cipher: machine.keyCipher,
			iv: machine.keyIv,
			dekCipher: machine.keyDekCipher,
			dekIv: machine.keyDekIv
		});
		let passphrase: string | undefined;
		if (
			machine.passphraseCipher &&
			machine.passphraseIv &&
			machine.passphraseDekCipher &&
			machine.passphraseDekIv
		) {
			passphrase = await decryptSecret({
				cipher: machine.passphraseCipher,
				iv: machine.passphraseIv,
				dekCipher: machine.passphraseDekCipher,
				dekIv: machine.passphraseDekIv
			});
		}
		creds.privateKey = { pem, passphrase };
	}
	return creds;
}

// gate machine edit/delete/use on ownership + the matrix (mirrors requireAdapterAccess)
export async function requireMachineAccess(
	event: H3Event,
	machineId: string,
	action: 'manage' | 'use'
): Promise<{ user: SessionUser; machine: Machine }> {
	const user = await requireAuthed(event);
	const rows = await db.select().from(machines).where(eq(machines.id, machineId)).limit(1);
	const machine = rows[0];
	if (!machine) throw createError({ statusCode: 404, statusMessage: 'Machine not found' });

	const caps = await capabilitiesFor(user.role);
	const isOwner = !!machine.ownerId && machine.ownerId === user.id;
	if (action === 'manage') {
		// owners can manage their own; otherwise canManageMachines is required
		if (!isOwner && !caps.canManageMachines)
			throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	} else {
		// to launch a job: canTrain, and the machine must be shared or owned
		if (!caps.canTrain) throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
		if (!machine.shared && !isOwner)
			throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}
	return { user, machine };
}

// gate a job by ownership + the matrix (managers/admins see all)
export async function requireJobAccess(
	event: H3Event,
	jobId: string
): Promise<{ user: SessionUser; job: TrainingJob }> {
	const user = await requireAuthed(event);
	const rows = await db.select().from(trainingJobs).where(eq(trainingJobs.id, jobId)).limit(1);
	const job = rows[0];
	if (!job) throw createError({ statusCode: 404, statusMessage: 'Job not found' });
	const caps = await capabilitiesFor(user.role);
	if (job.authorId !== user.id && !caps.canManageMachines)
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	return { user, job };
}

// load + serialize a job (with its machine label) for an api response
export async function jobView(jobId: string): Promise<TrainingJobView | null> {
	const rows = await db.select().from(trainingJobs).where(eq(trainingJobs.id, jobId)).limit(1);
	const job = rows[0];
	if (!job) return null;
	let label: string | null = null;
	if (job.machineId) {
		const m = await db
			.select({ label: machines.label })
			.from(machines)
			.where(eq(machines.id, job.machineId))
			.limit(1);
		label = m[0]?.label ?? null;
	}
	return serializeJob(job, label);
}

export type ProbeInput = {
	sentinel:
		| { status: 'success'; sha256: string; size: number }
		| { status: 'failed'; exitCode: number }
		| null;
	pidAlive: boolean;
	heartbeatEpoch: number | null;
	nowEpoch: number;
};

export type ProbeDecision =
	| { kind: 'success'; sha256: string; size: number }
	| { kind: 'reported_failure'; exitCode: number }
	| { kind: 'running' }
	| { kind: 'transient' }
	| { kind: 'abnormal' };

export function decideProbe(input: ProbeInput, consecutiveFailures: number): ProbeDecision {
	if (input.sentinel?.status === 'success')
		return { kind: 'success', sha256: input.sentinel.sha256, size: input.sentinel.size };
	if (input.sentinel?.status === 'failed')
		return { kind: 'reported_failure', exitCode: input.sentinel.exitCode };

	const heartbeatFresh =
		input.heartbeatEpoch != null &&
		input.nowEpoch - input.heartbeatEpoch <= HEARTBEAT_STALE_MS / 1000;

	// alive (pid present OR a fresh heartbeat) and no sentinel -> still running
	if (input.pidAlive || heartbeatFresh) return { kind: 'running' };

	// no sentinel, pid gone, stale heartbeat -> abnormal once we have enough confirmations
	if (consecutiveFailures + 1 >= ABNORMAL_THRESHOLD) return { kind: 'abnormal' };
	return { kind: 'transient' };
}

// fold a terminal job into the training analytics rollups (timing, gpu, status); never throws
async function recordFinishTelemetry(jobId: string, status: JobStatus) {
	try {
		const job = (
			await db.select().from(trainingJobs).where(eq(trainingJobs.id, jobId)).limit(1)
		)[0];
		if (!job) return;
		let gpu: string | null = null;
		if (job.machineId) {
			const m = (
				await db
					.select({ gpuInfo: machines.gpuInfo })
					.from(machines)
					.where(eq(machines.id, job.machineId))
					.limit(1)
			)[0];
			const g = m?.gpuInfo ? safeJson<GpuInfo>(m.gpuInfo) : null;
			gpu = g?.name ?? null;
		}
		const durationSeconds =
			job.startedAt && job.finishedAt
				? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
				: null;
		await recordTrainingFinish(todayUTC(), {
			status,
			gpu,
			durationSeconds,
			etaSeconds: job.etaSeconds
		});
	} catch {
		// telemetry is best-effort
	}
}

async function fail(jobId: string, failureClass: FailureClass, message: string) {
	const status: JobStatus = failureClass === 'abnormal' ? 'abnormal' : 'failed';
	await db
		.update(trainingJobs)
		.set({
			status,
			failureClass,
			statusMessage: message.slice(0, 500),
			finishedAt: new Date(),
			nextPollAt: null,
			updatedAt: new Date()
		})
		.where(eq(trainingJobs.id, jobId));
	await recordFinishTelemetry(jobId, status);
}

// advance one job by exactly one step; safe to call from cron + alarm concurrently
export async function advanceJob(jobId: string): Promise<void> {
	// quick terminal peek - no lease needed
	const peek = (
		await db
			.select({ status: trainingJobs.status })
			.from(trainingJobs)
			.where(eq(trainingJobs.id, jobId))
			.limit(1)
	)[0];
	if (!peek || isTerminalJob(peek.status)) return;

	// auto-expiring lease: only ONE driver advances a job at a time (cron / page poll / modal poll / DO
	// alarm all call in). prevents duplicate work - e.g. concurrent syncAndVerify runs each creating their
	// own adapter row - and lets a job whose worker died mid-step be reclaimed once the lease expires.
	const acquiredAt = Date.now();
	const lease = await db
		.update(trainingJobs)
		.set({ lockedAt: new Date(acquiredAt) })
		.where(
			and(
				eq(trainingJobs.id, jobId),
				or(
					isNull(trainingJobs.lockedAt),
					lt(trainingJobs.lockedAt, new Date(acquiredAt - LEASE_MS))
				)
			)
		);
	if (!changed(lease)) return; // another driver holds the lease

	try {
		const rows = await db.select().from(trainingJobs).where(eq(trainingJobs.id, jobId)).limit(1);
		const job = rows[0];
		if (!job || isTerminalJob(job.status)) return;

		const machineRows = job.machineId
			? await db.select().from(machines).where(eq(machines.id, job.machineId)).limit(1)
			: [];
		const machine = machineRows[0];
		if (!machine) {
			await fail(jobId, 'preflight', 'Machine no longer exists.');
			return;
		}
		const config = safeJson<TrainingConfigView>(job.config);
		if (!config) {
			await fail(jobId, 'preflight', 'Invalid job configuration.');
			return;
		}

		const creds = await resolveMachineCreds(machine);

		if (job.status === 'queued' || job.status === 'provisioning' || job.status === 'launching') {
			// claim from 'queued' ONLY so a slow launch (minutes of cold torch/cuda downloads) is never
			// re-entered by a concurrent cron/poll driver - re-entry would spawn a second run.sh that
			// rm -rf's the half-built venv and restarts every download (a bandwidth storm). recover a
			// launch that genuinely crashed (still provisioning, no pid recorded) only after a long stall.
			const stalledMs = Date.now() - new Date(job.updatedAt).getTime();
			const recoverable = job.status !== 'queued' && !job.pid && stalledMs > LAUNCH_STALL_MS;
			const claimable: JobStatus[] = recoverable
				? ['queued', 'provisioning', 'launching']
				: ['queued'];
			const claim = await db
				.update(trainingJobs)
				.set({ status: 'provisioning', updatedAt: new Date() })
				.where(and(eq(trainingJobs.id, jobId), inArray(trainingJobs.status, claimable)));
			if (!changed(claim)) return;
			try {
				await launch(job, machine, creds, config);
			} catch (e) {
				// a launch error (ssh connect, dataset push, spawn) must fail LOUDLY with the cause - not
				// leave the job silently stuck in 'provisioning' until the long stall timeout
				const msg = (e as Error)?.message ?? String(e);
				await failWithLog(jobId, 'preflight', `Launch failed: ${msg}`, `[launch] error: ${msg}`);
			}
			return;
		}

		if (job.status === 'running') {
			await pollRunning(job, creds);
			return;
		}

		if (job.status === 'syncing' || job.status === 'verifying') {
			await syncAndVerify(job, machine, creds, config);
			return;
		}

		if (job.status === 'publishing') {
			await publishResult(job, config);
			return;
		}
	} catch (e) {
		const msg = (e as Error)?.message ?? String(e);
		// transient connection-ish errors during a running poll should not kill the job
		console.warn(`advanceJob ${jobId} step error:`, msg);
		await db
			.update(trainingJobs)
			.set({ statusMessage: msg.slice(0, 500), updatedAt: new Date() })
			.where(eq(trainingJobs.id, jobId));
	} finally {
		// release the lease so the next tick can advance the next step promptly
		await db
			.update(trainingJobs)
			.set({ lockedAt: null })
			.where(eq(trainingJobs.id, jobId))
			.catch(() => {});
	}
}

// record a verbose log on the job then mark it failed (so preflight detail is never lost)
async function failWithLog(
	jobId: string,
	failureClass: FailureClass,
	message: string,
	logTail: string
) {
	await db
		.update(trainingJobs)
		.set({ logTail: logTail.slice(0, 8000), updatedAt: new Date() })
		.where(eq(trainingJobs.id, jobId));
	await fail(jobId, failureClass, message);
}

async function launch(
	job: TrainingJob,
	machine: Machine,
	creds: RemoteCreds,
	config: TrainingConfigView
) {
	const pre = await preflight(creds);
	// verbose preflight detail, always recorded so the user can see exactly what was found. each line is
	// timestamped (HH:MM:SS UTC) at the moment it is recorded so the worker-side milestones line up
	const stamp = () => new Date().toISOString().slice(11, 19);
	const log: string[] = [];
	const note = (m: string) => log.push(`[${stamp()}] ${m}`);
	// attribution: who launched this job (stamped in the provisioning log + the box train.log)
	const author = job.authorId
		? (
				await db
					.select({ username: users.username })
					.from(users)
					.where(eq(users.id, job.authorId))
					.limit(1)
			)[0]
		: null;
	const requestedBy = author?.username ?? null;
	if (requestedBy) note(`[job] requested by ${requestedBy}`);
	note(`[preflight] gpu: ${pre.gpu ? `${pre.gpu.name} (${pre.gpu.vramMb}MB)` : 'none detected'}`);
	note(
		`[preflight] python: ${pre.pythonVersion ?? 'not found'} (${pre.pythonOk ? 'ok' : 'needs >= 3.11'})`
	);
	note(`[preflight] pip: ${pre.pipOk ? 'ok' : 'missing'} | sudo: ${pre.sudo ? 'yes' : 'no'}`);
	const dump = (extra: string[] = []) =>
		[...log, ...extra.map((m) => `[${stamp()}] ${m}`)].join('\n');

	if (!pre.pythonOk) {
		await failWithLog(
			job.id,
			'preflight',
			`Python 3.11+ not found on the machine (found ${pre.pythonVersion ?? 'none'}).`,
			dump()
		);
		return;
	}
	if (!pre.pipOk) {
		await failWithLog(job.id, 'preflight', 'pip is not available on the machine.', dump());
		return;
	}

	// auto-tune the config to the detected VRAM (enable QLoRA / drop batch) per doc2lora's GPU guidance
	let tuned: TrainingConfigView = config;
	if (config.device !== 'cpu') {
		if (!pre.gpu) {
			await failWithLog(
				job.id,
				'preflight',
				'No GPU detected; set device to CPU or use a GPU machine.',
				dump()
			);
			return;
		}
		const tune = tuneConfigForVram(config, pre.gpu.vramMb);
		if (!tune.feasible) {
			await failWithLog(
				job.id,
				'preflight',
				`GPU VRAM (${pre.gpu.vramMb}MB) is insufficient: ${tune.reason}.`,
				dump([`[autotune] not feasible - ${tune.reason}`])
			);
			return;
		}
		tuned = { ...config, ...tune.config };
		if (tune.adjustments.length) for (const a of tune.adjustments) note(`[autotune] ${a}`);
		else note('[autotune] config fits the available VRAM; no changes');
	}

	// doc2lora trains on uploaded files; peft loads its dataset from huggingface on the box
	let files: { name: string; bytes: Uint8Array }[] = [];
	if (job.engine === 'doc2lora') {
		if (!job.datasetId) {
			await failWithLog(job.id, 'preflight', 'No dataset attached.', dump());
			return;
		}
		files = await loadDatasetFiles(job.datasetId);
		if (!files.length) {
			await failWithLog(job.id, 'preflight', 'Dataset object missing from storage.', dump());
			return;
		}
		note(`[input] pushing ${files.length} file(s) to the machine`);
	}
	const hfToken = await decryptJobHfToken(job);

	// sudo: the run-as username + password are ephemeral (stashed per-launch, never persisted). the
	// username defaults to the ssh login user; the password defaults to the machine's ssh password when
	// it has one. both live only in the launched process env, never on disk and never in the job record
	let sudoPassword: string | null = null;
	let sudoUser: string | null = null;
	if (tuned.useSudo) {
		const stashed = await takeSudoCreds(job.id);
		sudoUser = stashed?.user || machine.username;
		sudoPassword = stashed?.password || creds.password || null;
		note(
			`[sudo] training runs under sudo as ${sudoUser} (${sudoPassword ? 'password supplied' : 'passwordless / sudo -n'})`
		);
	}
	const attempt = job.attempt + 1;
	note(`[attempt] === Attempt #${attempt} ===`);
	note(`[launch] starting ${job.engine} on ${machine.label}`);
	note(
		`[output] adapter "${config.outputName?.trim() || `${machine.label} adapter`}" (slug ${config.outputSlug?.trim() || 'trained-<auto>'})`
	);

	await db
		.update(trainingJobs)
		.set({
			statusMessage: 'Provisioning the machine (connecting, pushing inputs, launching).',
			logTail: dump(['[provision] connecting, pushing inputs, and launching the run...']),
			updatedAt: new Date()
		})
		.where(eq(trainingJobs.id, job.id));

	const trainBaseModel = hfModelFor(tuned.baseModel);
	if (trainBaseModel !== tuned.baseModel)
		note(`[launch] training base ${tuned.baseModel} -> ${trainBaseModel} (huggingface)`);
	const launchConfig: TrainingConfigView = { ...tuned, baseModel: trainBaseModel };

	const { pid, pgid, wrapperId } = await provisionAndLaunch({
		creds,
		jobId: job.id,
		engine: job.engine,
		config: launchConfig,
		files,
		hfToken,
		sudoPassword,
		sudoUser,
		attempt,
		requestedBy
	});

	// persist the (possibly auto-tuned) config so the UI + a retry reflect what actually ran
	const mergedConfig = { ...config, ...tuned };
	await db
		.update(trainingJobs)
		.set({
			status: 'running',
			pid,
			pgid,
			wrapperId,
			jobDir: `/tmp/mylora-jobs/${job.id}`,
			startedAt: new Date(),
			lastHeartbeatAt: new Date(),
			consecutiveFailures: 0,
			attempt: job.attempt + 1,
			config: JSON.stringify(mergedConfig),
			statusMessage: 'Training started.',
			logTail: dump(),
			nextPollAt: new Date(Date.now() + POLL_INTERVAL_MS),
			updatedAt: new Date()
		})
		.where(eq(trainingJobs.id, job.id));
	// telemetry: a job started running
	await recordTrainingStart(todayUTC(), { engine: job.engine, model: tuned.baseModel });
}

async function pollRunning(job: TrainingJob, creds: RemoteCreds) {
	// throttle actual SSH probes so the UI's rapid polling (page + open modal) cannot hammer the box
	// with a connection every few seconds; one probe per MIN_PROBE_INTERVAL_MS is plenty. skipped under
	// the ssh mock so the e2e driver (which polls in a tight loop) advances jobs without waiting
	if (
		!isMockSsh() &&
		job.lastProbeAt &&
		Date.now() - new Date(job.lastProbeAt).getTime() < MIN_PROBE_INTERVAL_MS
	) {
		return;
	}
	const outcome = await probe(creds, job.id, job.pid ?? 0);
	const now = new Date();

	if ('connError' in outcome) {
		const failures = job.consecutiveFailures + 1;
		if (failures >= ABNORMAL_THRESHOLD) {
			await fail(job.id, 'abnormal', `Lost contact with the machine: ${outcome.connError.message}`);
			return;
		}
		await db
			.update(trainingJobs)
			.set({
				consecutiveFailures: failures,
				statusMessage: `Transient connection issue (${failures}/${ABNORMAL_THRESHOLD}): ${outcome.connError.message}`,
				lastProbeAt: now,
				nextPollAt: new Date(Date.now() + POLL_FAST_MS),
				updatedAt: now
			})
			.where(eq(trainingJobs.id, job.id));
		return;
	}

	const parsed = outcome.parsed;
	const decision = decideProbe(
		{
			sentinel: parsed.sentinel,
			pidAlive: parsed.pidAlive,
			heartbeatEpoch: parsed.heartbeatEpoch,
			nowEpoch: Math.floor(Date.now() / 1000)
		},
		job.consecutiveFailures
	);

	if (decision.kind === 'success') {
		await db
			.update(trainingJobs)
			.set({
				status: 'syncing',
				adapterSha: decision.sha256,
				adapterSize: decision.size,
				consecutiveFailures: 0,
				statusMessage: 'Training finished; syncing adapter.',
				logTail: parsed.logTail || job.logTail,
				lastProbeAt: now,
				nextPollAt: new Date(Date.now() + POLL_FAST_MS),
				updatedAt: now
			})
			.where(and(eq(trainingJobs.id, job.id), eq(trainingJobs.status, 'running')));
		return;
	}
	if (decision.kind === 'reported_failure') {
		// capture the tail + persist the full log before marking failed (so the cause is never lost)
		await db
			.update(trainingJobs)
			.set({ logTail: (parsed.logTail || job.logTail || '').slice(0, 20000), updatedAt: now })
			.where(eq(trainingJobs.id, job.id));
		// classify on the full log + tail: a HuggingFace gated/401 becomes 'gated', else 'reported'
		const fullLog = await persistJobLog(job.id, creds);
		const cls = classifyTrainingFailure(`${fullLog}\n${parsed.logTail || ''}`, decision.exitCode);
		await fail(job.id, cls.failureClass, cls.message);
		return;
	}
	if (decision.kind === 'abnormal') {
		await db
			.update(trainingJobs)
			.set({ logTail: (parsed.logTail || job.logTail || '').slice(0, 20000), updatedAt: now })
			.where(eq(trainingJobs.id, job.id));
		await persistJobLog(job.id, creds);
		await fail(
			job.id,
			'abnormal',
			'The training process died without a result (OOM, kill, reboot, or tunnel drop).'
		);
		return;
	}

	// running or transient
	const failures = decision.kind === 'transient' ? job.consecutiveFailures + 1 : 0;

	// doc2lora's `scan` prints a real per-machine time estimate; once it appears in the log, use it to
	// replace the coarse byte-based estimate (the tail carries it during the pre-training phase)
	const scanEta = parseScanEstimateSeconds(parsed.logTail);
	await db
		.update(trainingJobs)
		.set({
			consecutiveFailures: failures,
			etaSeconds: scanEta && scanEta !== job.etaSeconds ? scanEta : undefined,
			lastHeartbeatAt: parsed.heartbeatEpoch
				? new Date(parsed.heartbeatEpoch * 1000)
				: job.lastHeartbeatAt,
			lastProbeAt: now,
			statusMessage: failures
				? `Process not visible (${failures}/${ABNORMAL_THRESHOLD})`
				: 'Training in progress.',
			logTail: parsed.logTail || job.logTail,
			// persist the latest live telemetry sample when present (keep the prior one otherwise). lock in
			// the first net reading as a baseline so the UI can show bandwidth consumed BY this run
			telemetry: parsed.telemetry
				? JSON.stringify(withNetBaseline(parsed.telemetry, job.telemetry))
				: undefined,
			nextPollAt: new Date(Date.now() + (failures ? POLL_FAST_MS : POLL_INTERVAL_MS)),
			updatedAt: now
		})
		.where(eq(trainingJobs.id, job.id));
}

async function syncAndVerify(
	job: TrainingJob,
	machine: Machine,
	creds: RemoteCreds,
	config: TrainingConfigView
) {
	// resolve the CF lora family: doc2lora carries it from the curated base; peft derives it from
	// the (possibly arbitrary) HF base; accelerate (diffusion LoRA) is never CF-deployable.
	const cfModelType =
		job.engine === 'accelerate'
			? null
			: job.engine === 'doc2lora'
				? (config.modelType ?? detectModelType(config.baseModel))
				: detectModelType(config.baseModel);

	// persist the successful run's full log alongside the artifacts before we touch the box further
	await persistJobLog(job.id, creds);

	const { configBytes, weights } = await pullAdapter(creds, job.id, job.engine);
	const bytes = new Uint8Array(await new Response(weights).arrayBuffer());
	const sha = await sha256Hex(bytes);

	// integrity gate: the pulled bytes must match the sentinel's sha + size
	if (job.adapterSha && sha !== job.adapterSha) {
		await fail(job.id, 'verify', 'Adapter integrity check failed (sha256 mismatch).');
		return;
	}
	if (job.adapterSize && job.adapterSize !== bytes.length) {
		await fail(job.id, 'verify', 'Adapter integrity check failed (size mismatch).');
		return;
	}

	if (!cfModelType) {
		// not CF-deployable (peft on an arbitrary base, or an accelerate/diffusion LoRA): keep the
		// artifact under the job for download (canonical weights.safetensors), no catalog row
		if (configBytes) {
			await blob.put(`jobs/${job.id}/adapter_config.json`, configBytes, {
				contentType: 'application/json'
			});
		}
		await blob.put(`jobs/${job.id}/weights.safetensors`, bytes, {
			contentType: 'application/octet-stream'
		});
		await db
			.update(trainingJobs)
			.set({
				status: 'completed',
				downloadOnly: true,
				adapterSize: bytes.length,
				adapterSha: sha,
				statusMessage:
					'Completed; adapter ready for download (base model is not Cloudflare-deployable).',
				finishedAt: new Date(),
				nextPollAt: null,
				updatedAt: new Date()
			})
			.where(eq(trainingJobs.id, job.id));
		await recordFinishTelemetry(job.id, 'completed');
		return;
	}

	// cf-deployable: create-or-reuse the catalog adapter row (idempotent on job.adapterId)
	let adapterId = job.adapterId;
	if (!adapterId) {
		adapterId = crypto.randomUUID().replace(/-/g, '');
		// custom output name/slug from the job config, else the defaults ("<machine> adapter" / "trained-<id>")
		const desiredName = config.outputName?.trim() || `${machine.label} adapter`;
		const slug = await uniqueSlug(config.outputSlug?.trim() || `trained-${adapterId.slice(0, 8)}`);
		await db.insert(adapters).values({
			id: adapterId,
			name: desiredName,
			slug,
			description: `Trained on ${machine.label} via ${job.engine}.`,
			baseModel: config.baseModel,
			modelType: cfModelType,
			rank: config.rank,
			examples: '[]',
			screenshots: '[]',
			visibility: job.autoPublish ? 'public' : 'unlisted',
			cfPublic: job.autoPublish,
			accountId: job.accountId ?? null,
			authorId: job.authorId,
			status: 'draft'
		});
		await db
			.update(trainingJobs)
			.set({ adapterId, updatedAt: new Date() })
			.where(eq(trainingJobs.id, job.id));
	}

	// canonicalize the config's model_type from our metadata (never trust the file)
	const rawConfig = configBytes ? new TextDecoder().decode(configBytes) : '{}';
	const canonical = canonicalizeAdapterConfig(rawConfig, cfModelType);
	const configOut = new TextEncoder().encode(canonical.json);

	await blob.put(`adapters/${adapterId}/adapter_config.json`, configOut, {
		contentType: 'application/json'
	});
	await blob.put(`adapters/${adapterId}/adapter_model.safetensors`, bytes, {
		contentType: 'application/octet-stream'
	});

	await db
		.update(adapters)
		.set({
			configBytes: configOut.length,
			weightsBytes: bytes.length,
			status: 'listed',
			updatedAt: new Date()
		})
		.where(eq(adapters.id, adapterId));

	await db
		.update(trainingJobs)
		.set({
			status: 'publishing',
			statusMessage: 'Adapter synced and verified.',
			nextPollAt: new Date(Date.now() + POLL_FAST_MS),
			updatedAt: new Date()
		})
		.where(eq(trainingJobs.id, job.id));
}

async function publishResult(job: TrainingJob, _config: TrainingConfigView) {
	const adapterId = job.adapterId;
	const complete = async (message: string) => {
		await db
			.update(trainingJobs)
			.set({
				status: 'completed',
				statusMessage: message,
				finishedAt: new Date(),
				nextPollAt: null,
				updatedAt: new Date()
			})
			.where(eq(trainingJobs.id, job.id));
		await recordFinishTelemetry(job.id, 'completed');
	};

	if (!adapterId || !job.autoUploadFinetune) {
		await complete(job.autoPublish ? 'Completed; Adapter Listed.' : 'Completed; Adapter Drafted.');
		return;
	}

	// optional auto-upload to the cloudflare finetune catalog (best-effort; training already succeeded)
	const adapterRows = await db.select().from(adapters).where(eq(adapters.id, adapterId)).limit(1);
	const adapter = adapterRows[0];
	if (!adapter) {
		await complete('Completed; adapter row missing for finetune upload.');
		return;
	}
	const account = await pickAccount(job.accountId);
	if (!account) {
		await complete('Completed; no Cloudflare account available for auto-upload.');
		return;
	}
	try {
		await assertEncryptionKey();
		const token = await decryptToken(account);
		await db
			.update(adapters)
			.set({ status: 'pushing', accountId: account.id, updatedAt: new Date() })
			.where(eq(adapters.id, adapterId));
		const ft = await createFinetune(account.accountId, token, {
			model: adapter.baseModel,
			name: adapter.slug,
			description: adapter.description || undefined
		});
		// docs order: adapter_model.safetensors FIRST, then adapter_config.json
		const cfg = await blob.get(`adapters/${adapterId}/adapter_config.json`);
		const wts = await blob.get(`adapters/${adapterId}/adapter_model.safetensors`);
		if (wts)
			await uploadFinetuneAsset(account.accountId, token, ft.id, 'adapter_model.safetensors', wts);
		if (cfg) await uploadFinetuneAsset(account.accountId, token, ft.id, 'adapter_config.json', cfg);
		await db
			.update(adapters)
			.set({
				status: 'published',
				finetuneId: ft.id,
				finetuneName: adapter.slug,
				updatedAt: new Date()
			})
			.where(eq(adapters.id, adapterId));
		await db
			.update(cloudflareAccounts)
			.set({ adapterCount: sql`${cloudflareAccounts.adapterCount} + 1`, updatedAt: new Date() })
			.where(eq(cloudflareAccounts.id, account.id));
		await complete('Completed and published to Cloudflare.');
	} catch (e) {
		const msg = explainCfError(e);
		await db
			.update(adapters)
			.set({ status: 'listed', statusMessage: `Auto-upload failed: ${msg}`, updatedAt: new Date() })
			.where(eq(adapters.id, adapterId));
		await complete(`Completed; auto-upload to Cloudflare failed (${msg}). Adapter is listed.`);
	}
}

async function pickAccount(explicitId?: string | null) {
	if (explicitId) {
		const r = await db
			.select()
			.from(cloudflareAccounts)
			.where(eq(cloudflareAccounts.id, explicitId))
			.limit(1);
		if (r[0]) return r[0];
	}
	const def = await db
		.select()
		.from(cloudflareAccounts)
		.where(and(eq(cloudflareAccounts.isActive, true), eq(cloudflareAccounts.isDefault, true)))
		.limit(1);
	if (def[0]) return def[0];
	const shared = await db
		.select()
		.from(cloudflareAccounts)
		.where(and(eq(cloudflareAccounts.isActive, true), eq(cloudflareAccounts.shared, true)))
		.limit(1);
	return shared[0];
}

async function uniqueSlug(base: string): Promise<string> {
	let slug = base;
	let n = 1;
	for (;;) {
		const existing = await db
			.select({ id: adapters.id })
			.from(adapters)
			.where(eq(adapters.slug, slug))
			.limit(1);
		if (!existing.length) return slug;
		slug = `${base}-${n++}`;
	}
}

// ids of every non-terminal job (the cron trigger drives each one)
export async function activeJobIds(): Promise<string[]> {
	const all = await db
		.select({ id: trainingJobs.id, status: trainingJobs.status })
		.from(trainingJobs)
		.where(notInArray(trainingJobs.status, ['completed', 'failed', 'abnormal', 'aborted']));
	return all.map((r) => r.id);
}

// opportunistic per-job durable-object alarm (tighter cadence than the 1-minute cron when it runs)
export async function kickJob(jobId: string): Promise<void> {
	try {
		const env = (globalThis as { __env__?: Record<string, unknown> }).__env__;
		const binding = env?.['$DurableObject'] as
			| {
					idFromName(n: string): unknown;
					get(id: unknown): { fetch(req: Request): Promise<Response> };
			  }
			| undefined;
		if (!binding) return;
		const stub = binding.get(binding.idFromName(`job:${jobId}`));
		await stub.fetch(new Request(`https://do/_do/training-kick?jobId=${jobId}`));
	} catch {
		// the cron trigger remains the guaranteed driver if the alarm cannot be scheduled
	}
}

export async function abortJob(jobId: string): Promise<void> {
	const rows = await db.select().from(trainingJobs).where(eq(trainingJobs.id, jobId)).limit(1);
	const job = rows[0];
	if (!job || isTerminalJob(job.status)) return;
	// any per-launch sudo stash is now void
	await clearSudoPassword(jobId);
	if (job.machineId && job.pgid) {
		const m = (await db.select().from(machines).where(eq(machines.id, job.machineId)).limit(1))[0];
		if (m) {
			const config = safeJson<TrainingConfigView>(job.config);
			try {
				const creds = await resolveMachineCreds(m);
				// capture the partial log before killing; an elevated run needs an elevated kill (we can
				// only reuse the ssh password here - the ephemeral key-auth sudo pw is already gone)
				await persistJobLog(job.id, creds);
				await remoteAbort(creds, job.id, job.pgid, {
					useSudo: config?.useSudo === true,
					sudoPassword: creds.password ?? null
				});
			} catch {
				// best-effort kill
			}
		}
	}
	await db
		.update(trainingJobs)
		.set({
			status: 'aborted',
			failureClass: 'aborted',
			statusMessage: 'Aborted by user.',
			finishedAt: new Date(),
			nextPollAt: null,
			updatedAt: new Date()
		})
		.where(eq(trainingJobs.id, jobId));
	await recordFinishTelemetry(jobId, 'aborted');
}
