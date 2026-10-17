import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { blob } from 'hub:blob';
import { db } from 'hub:db';
import {
	adapters,
	inferenceEndpoints,
	machines,
	type InferenceEndpoint,
	type Machine
} from 'hub:db:schema';
import { hfModelFor, type ServeStartInput } from '~/shared/schemas';
import type { ServeConfig, ServeStatus } from '~/shared/types';
import { assertEncryptionKey, decryptSecret, encryptSecret } from './crypto';
import { decryptEndpointKey, encryptEndpointKey, loadEndpoint } from './endpoints';
import { assertNgrokSource, resolveNgrokToken } from './ngrok-tokens';
import { redactSecrets } from './remote-commands';
import {
	buildEnvFile,
	buildServeScript,
	probeServe,
	provisionServe,
	serveDirFor,
	stopServeRemote,
	toServeTooling,
	type ServeAdapterFile
} from './remote-serve';
import { toolingFor } from './tooling';
import { resolveMachineCreds } from './training';

const LEASE_MS = 2 * 60 * 1000;
const POLL_STARTING_MS = 10_000;
const POLL_READY_MS = 5 * 60 * 1000;
// the first start downloads the model, so a slow box gets a long time before it counts as failed
const START_TIMEOUT_MS = 90 * 60 * 1000;
const ACTIVE: ServeStatus[] = ['queued', 'provisioning', 'starting', 'ready', 'stopping'];

function randomKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return `mylora_${btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

function parseConfig(row: InferenceEndpoint): ServeConfig | null {
	try {
		return row.serveConfig ? (JSON.parse(row.serveConfig) as ServeConfig) : null;
	} catch {
		return null;
	}
}

type Launch = { hfToken?: string | null; tunnelToken?: string | null };

async function readSecrets(row: InferenceEndpoint): Promise<Launch> {
	if (!row.secretsCipher || !row.secretsIv || !row.secretsDekCipher || !row.secretsDekIv) return {};
	try {
		return JSON.parse(
			await decryptSecret({
				cipher: row.secretsCipher,
				iv: row.secretsIv,
				dekCipher: row.secretsDekCipher,
				dekIv: row.secretsDekIv
			})
		) as Launch;
	} catch {
		return {};
	}
}

async function patch(id: string, values: Partial<typeof inferenceEndpoints.$inferInsert>) {
	await db
		.update(inferenceEndpoints)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(inferenceEndpoints.id, id));
}

function clip(text: string, max = 3000): string {
	return redactSecrets(text).slice(-max);
}

/**
 * Creates the endpoint record for a vLLM server and queues it. The adapters are checked here, so a
 * mismatch fails the request instead of a server that starts and then cannot load them.
 */
export async function startServe(
	owner: { id: string; canEditAny: boolean },
	machine: Machine,
	input: ServeStartInput
): Promise<InferenceEndpoint> {
	if (!machine.isActive) {
		throw createError({ statusCode: 409, statusMessage: 'That machine is not active' });
	}
	if (input.tunnel === 'cloudflared' && input.tunnelToken && !input.hostname) {
		throw createError({
			statusCode: 400,
			statusMessage: 'A named cloudflared tunnel needs its public hostname'
		});
	}

	if (input.tunnel === 'ngrok') await assertNgrokSource(input.ngrokToken, owner.id);

	// serving copies the weights to the machine, so only adapters the caller could download anyway
	// qualify; a private one answers like a missing one
	const rows = (
		await db.select().from(adapters).where(inArray(adapters.id, input.adapterIds))
	).filter((a) => owner.canEditAny || a.authorId === owner.id || a.visibility === 'public');
	if (rows.length !== new Set(input.adapterIds).size) {
		throw createError({ statusCode: 400, statusMessage: 'One of the adapters does not exist' });
	}
	for (const a of rows) {
		if (!a.configBytes || !a.weightsBytes) {
			throw createError({
				statusCode: 400,
				statusMessage: `${a.name} has no uploaded files to serve`
			});
		}
		if (hfModelFor(a.baseModel) !== input.baseModel) {
			throw createError({
				statusCode: 400,
				statusMessage: `${a.name} was trained on ${hfModelFor(a.baseModel)}, not ${input.baseModel}`
			});
		}
		if (a.rank > input.maxLoraRank) {
			throw createError({
				statusCode: 400,
				statusMessage: `${a.name} has rank ${a.rank}, above the server's max LoRA rank ${input.maxLoraRank}`
			});
		}
	}

	await assertEncryptionKey();
	const id = crypto.randomUUID().replace(/-/g, '');
	const apiKey = randomKey();
	const secrets: Launch = {
		hfToken: input.hfToken || null,
		tunnelToken: input.tunnelToken || null
	};
	const sealed = await encryptSecret(JSON.stringify(secrets));
	const config: ServeConfig = {
		baseModel: input.baseModel,
		port: input.port,
		tunnel: input.tunnel,
		maxLoraRank: input.maxLoraRank,
		hostname: input.hostname || undefined,
		ngrokToken: input.tunnel === 'ngrok' ? input.ngrokToken : undefined,
		adapters: rows.map((a) => ({ adapterId: a.id, name: a.slug }))
	};

	await db.insert(inferenceEndpoints).values({
		id,
		label: input.label,
		ownerId: owner.id,
		shared: input.shared,
		source: 'vllm',
		baseUrl: '',
		defaultModel: config.adapters[0]?.name ?? null,
		...(await encryptEndpointKey(apiKey)),
		machineId: machine.id,
		serveStatus: 'queued',
		serveConfig: JSON.stringify(config),
		secretsCipher: sealed.cipher,
		secretsIv: sealed.iv,
		secretsDekCipher: sealed.dekCipher,
		secretsDekIv: sealed.dekIv,
		nextPollAt: new Date()
	});
	return (await loadEndpoint(id))!;
}

async function machineFor(row: InferenceEndpoint): Promise<Machine | null> {
	if (!row.machineId) return null;
	return (
		(await db.select().from(machines).where(eq(machines.id, row.machineId)).limit(1))[0] ?? null
	);
}

async function failServe(id: string, message: string) {
	await patch(id, {
		serveStatus: 'failed',
		logTail: clip(message),
		health: 'unreachable',
		lastDiagnosis: clip(message, 300),
		secretsCipher: null,
		secretsIv: null,
		secretsDekCipher: null,
		secretsDekIv: null,
		nextPollAt: null,
		stoppedAt: new Date()
	});
}

async function provision(row: InferenceEndpoint) {
	const config = parseConfig(row);
	const machine = await machineFor(row);
	if (!config || !machine) return failServe(row.id, 'The machine or the server settings are gone');

	await patch(row.id, { serveStatus: 'provisioning' });
	try {
		const creds = await resolveMachineCreds(machine);
		const apiKey = await decryptEndpointKey(row);
		if (!apiKey) throw new Error('The server key is missing');
		const secrets = await readSecrets(row);
		const tooling = await toolingFor(machine);
		const ngrokToken =
			config.tunnel === 'ngrok' ? await resolveNgrokToken(config.ngrokToken, row.ownerId) : null;

		const files: ServeAdapterFile[] = [];
		for (const a of config.adapters) {
			const weights = await blob.get(`adapters/${a.adapterId}/adapter_model.safetensors`);
			if (!weights) throw new Error(`The weights for ${a.name} are missing from storage`);
			files.push({
				name: a.name,
				config: await blob.get(`adapters/${a.adapterId}/adapter_config.json`),
				weights
			});
		}

		const { pid } = await provisionServe({
			creds,
			id: row.id,
			script: buildServeScript({
				dir: serveDirFor(row.id),
				port: config.port,
				baseModel: config.baseModel,
				maxLoraRank: config.maxLoraRank,
				tunnel: config.tunnel,
				hostname: config.hostname,
				named: !!secrets.tunnelToken,
				adapterNames: config.adapters.map((a) => a.name),
				tooling: toServeTooling(tooling)
			}),
			env: buildEnvFile({
				apiKey,
				hfToken: secrets.hfToken,
				tunnelToken: secrets.tunnelToken,
				ngrokToken
			}),
			adapters: files
		});
		// the box holds the secrets now; the copy kept for the launch is dropped
		await patch(row.id, {
			serveStatus: 'starting',
			pid,
			startedAt: new Date(),
			secretsCipher: null,
			secretsIv: null,
			secretsDekCipher: null,
			secretsDekIv: null,
			logTail: '[serve] files copied; the server is starting',
			nextPollAt: new Date(Date.now() + POLL_STARTING_MS)
		});
	} catch (error) {
		await failServe(row.id, `Could not start the server: ${(error as Error).message}`);
	}
}

async function killRemote(row: InferenceEndpoint, machine: Machine) {
	if (!row.pid) return;
	try {
		await stopServeRemote(await resolveMachineCreds(machine), row.id, row.pid);
	} catch {
		// best effort; an unreachable box has nothing we can stop
	}
}

async function check(row: InferenceEndpoint) {
	const machine = await machineFor(row);
	if (!machine || !row.pid) return failServe(row.id, 'The machine or the server process is gone');

	const outcome = await probeServe(await resolveMachineCreds(machine), row.id, row.pid);
	if ('connError' in outcome) {
		const timedOut =
			row.serveStatus === 'starting' &&
			row.startedAt &&
			Date.now() - new Date(row.startedAt).getTime() > START_TIMEOUT_MS;
		if (timedOut) {
			await killRemote(row, machine);
			return failServe(row.id, 'The machine stayed unreachable while the server started');
		}
		return patch(row.id, {
			health: 'unreachable',
			lastDiagnosis: outcome.connError.message,
			lastCheckedAt: new Date(),
			nextPollAt: new Date(Date.now() + POLL_STARTING_MS)
		});
	}

	const p = outcome.parsed;
	if (p.exit) return failServe(row.id, `${p.exit.message}\n${p.logTail}`);
	if (!p.pidAlive) return failServe(row.id, `The server process is not running\n${p.logTail}`);

	if (p.ready && p.url) {
		const baseUrl = `${p.url.replace(/\/+$/, '')}/v1`;
		await patch(row.id, {
			serveStatus: 'ready',
			baseUrl,
			health: 'ok',
			lastDiagnosis: 'Serving',
			lastCheckedAt: new Date(),
			logTail: clip(p.logTail),
			nextPollAt: new Date(Date.now() + POLL_READY_MS)
		});
		return;
	}
	if (row.startedAt && Date.now() - new Date(row.startedAt).getTime() > START_TIMEOUT_MS) {
		// still running but never ready: stop it so a failed record does not leave a process behind
		await killRemote(row, machine);
		return failServe(row.id, `The server did not become ready in time\n${p.logTail}`);
	}
	await patch(row.id, {
		logTail: clip(p.logTail),
		lastCheckedAt: new Date(),
		nextPollAt: new Date(Date.now() + POLL_STARTING_MS)
	});
}

async function stopNow(row: InferenceEndpoint) {
	const machine = await machineFor(row);
	if (machine && row.pid) {
		try {
			await stopServeRemote(await resolveMachineCreds(machine), row.id, row.pid);
		} catch {
			// a box that is already gone has nothing left to stop
		}
	}
	await patch(row.id, {
		serveStatus: 'stopped',
		baseUrl: '',
		health: 'unchecked',
		lastDiagnosis: null,
		stoppedAt: new Date(),
		nextPollAt: null,
		pid: null
	});
}

/** Advances one serve by one step; the lease keeps the cron, the page poll and a stop from overlapping. */
export async function advanceServe(id: string): Promise<void> {
	const peek = await loadEndpoint(id);
	if (!peek || peek.source !== 'vllm' || !peek.serveStatus || !ACTIVE.includes(peek.serveStatus))
		return;

	const now = Date.now();
	const claimed = await db
		.update(inferenceEndpoints)
		.set({ lockedAt: new Date(now) })
		.where(
			and(
				eq(inferenceEndpoints.id, id),
				or(
					isNull(inferenceEndpoints.lockedAt),
					lt(inferenceEndpoints.lockedAt, new Date(now - LEASE_MS))
				)
			)
		)
		.returning({ id: inferenceEndpoints.id });
	if (claimed.length === 0) return;

	try {
		const row = (await loadEndpoint(id))!;
		if (row.serveStatus === 'queued') await provision(row);
		else if (row.serveStatus === 'stopping') await stopNow(row);
		else if (row.serveStatus === 'starting' || row.serveStatus === 'ready') await check(row);
	} finally {
		await db
			.update(inferenceEndpoints)
			.set({ lockedAt: null })
			.where(eq(inferenceEndpoints.id, id));
	}
}

/** Marks the server for stopping and does it now; safe to call on one that is already down. */
export async function stopServe(id: string): Promise<void> {
	const row = await loadEndpoint(id);
	if (!row || row.source !== 'vllm') return;
	if (row.serveStatus === 'stopped' || row.serveStatus === 'failed') return;
	await patch(id, { serveStatus: 'stopping' });
	// a queued server never reached a box, so there is nothing to wait for
	await stopNow((await loadEndpoint(id))!);
}

/** Servers the cron should look at this tick: any active one that is due. */
export async function dueServeIds(): Promise<string[]> {
	const rows = await db
		.select({ id: inferenceEndpoints.id, nextPollAt: inferenceEndpoints.nextPollAt })
		.from(inferenceEndpoints)
		.where(inArray(inferenceEndpoints.serveStatus, ACTIVE));
	const now = Date.now();
	return rows
		.filter((r) => !r.nextPollAt || new Date(r.nextPollAt).getTime() <= now)
		.map((r) => r.id);
}
