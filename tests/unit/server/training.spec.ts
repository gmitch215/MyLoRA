import { beforeAll, describe, expect, it, vi } from 'vitest';

// training.ts pulls in hub bindings + ./remote (edgeport ssh) at load; mock them all so we can import
// and exercise only the pure serialize/fold/decision helpers
vi.mock('hub:blob', () => ({ blob: {} }));
vi.mock('hub:db', () => ({ db: {} }));
vi.mock('hub:kv', () => ({ kv: {} }));
vi.mock('hub:db:schema', () => ({
	adapters: {},
	cloudflareAccounts: {},
	machines: {},
	trainingJobs: {},
	users: {}
}));
vi.mock('../../../src/server/utils/remote', () => ({
	fetchRemoteLog: vi.fn(),
	isMockSsh: vi.fn(),
	preflight: vi.fn(),
	probe: vi.fn(),
	provisionAndLaunch: vi.fn(),
	pullAdapter: vi.fn(),
	abort: vi.fn()
}));

let mod: typeof import('../../../src/server/utils/training');

beforeAll(async () => {
	mod = await import('../../../src/server/utils/training');
});

describe('constants', () => {
	it('exposes sane polling/threshold values', () => {
		expect(mod.POLL_INTERVAL_MS).toBeGreaterThan(mod.POLL_FAST_MS);
		expect(mod.ABNORMAL_THRESHOLD).toBeGreaterThanOrEqual(1);
		expect(mod.HEARTBEAT_STALE_MS).toBeGreaterThan(0);
	});
});

describe('hashSelfReportToken', () => {
	it('produces a stable 64-char sha256 hex', async () => {
		const a = await mod.hashSelfReportToken('token');
		expect(a).toMatch(/^[0-9a-f]{64}$/);
		expect(await mod.hashSelfReportToken('token')).toBe(a);
		expect(await mod.hashSelfReportToken('other')).not.toBe(a);
	});
});

describe('redactMachine', () => {
	function machineRow(over: Record<string, unknown> = {}) {
		return {
			id: 'm1',
			label: 'box',
			ownerId: 'u1',
			shared: false,
			host: '1.2.3.4',
			port: 22,
			username: 'ubuntu',
			authMethod: 'key',
			connectionType: 'ssh',
			keySource: 'generated',
			publicKey: 'ssh-ed25519 AAAA',
			keyLast4: 'ab12',
			hostKeyFingerprint: 'SHA256:xxx',
			hostKeyType: 'ssh-ed25519',
			healthStatus: 'ok',
			lastDiagnosis: 'fine',
			lastCheckedAt: '2026-01-02T00:00:00.000Z',
			gpuInfo: '{"name":"A100"}',
			systemInfo: '{"os":"linux"}',
			toolingReady: true,
			selfReportTokenHash: 'HASH',
			isActive: true,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
			// secret columns that must not leak
			passwordCipher: 'CIPHER',
			privateKeyCipher: 'PKCIPHER',
			...over
		} as any;
	}

	it('parses gpu/system json and derives hasSelfReport', () => {
		const p = mod.redactMachine(machineRow());
		expect(p.gpuInfo).toEqual({ name: 'A100' });
		expect(p.systemInfo).toEqual({ os: 'linux' });
		expect(p.hasSelfReport).toBe(true);
		expect(p.lastCheckedAt).toBe('2026-01-02T00:00:00.000Z');
	});

	it('never exposes secret columns', () => {
		const p = mod.redactMachine(machineRow()) as any;
		expect(p.passwordCipher).toBeUndefined();
		expect(p.privateKeyCipher).toBeUndefined();
		expect(p.selfReportTokenHash).toBeUndefined();
	});

	it('handles null json/timestamps + missing self-report', () => {
		const p = mod.redactMachine(
			machineRow({
				gpuInfo: null,
				systemInfo: 'not json',
				lastCheckedAt: null,
				selfReportTokenHash: null
			})
		);
		expect(p.gpuInfo).toBeNull();
		expect(p.systemInfo).toBeNull();
		expect(p.lastCheckedAt).toBeNull();
		expect(p.hasSelfReport).toBe(false);
	});
});

describe('diagnosisToMachineUpdate', () => {
	it('maps ok -> ok', () => {
		const u = mod.diagnosisToMachineUpdate({ code: 'ok', message: 'good' } as any);
		expect(u.healthStatus).toBe('ok');
	});

	it('maps auth -> auth_failed', () => {
		expect(mod.diagnosisToMachineUpdate({ code: 'auth', message: 'x' } as any).healthStatus).toBe(
			'auth_failed'
		);
	});

	it('maps dns/refused/timeout -> unreachable', () => {
		for (const code of ['dns', 'refused', 'timeout']) {
			expect(mod.diagnosisToMachineUpdate({ code, message: 'x' } as any).healthStatus).toBe(
				'unreachable'
			);
		}
	});

	it('maps anything else -> degraded', () => {
		expect(mod.diagnosisToMachineUpdate({ code: 'weird', message: 'x' } as any).healthStatus).toBe(
			'degraded'
		);
	});

	it('truncates the diagnosis message to 300 chars', () => {
		const u = mod.diagnosisToMachineUpdate({ code: 'ok', message: 'x'.repeat(500) } as any);
		expect((u.lastDiagnosis as string).length).toBe(300);
	});

	it('serializes gpu/system info and copies optional fields', () => {
		const u = mod.diagnosisToMachineUpdate({
			code: 'ok',
			message: 'ok',
			hostKeyFingerprint: 'SHA256:fp',
			gpuInfo: { name: 'A100' },
			systemInfo: { os: 'linux' },
			toolingReady: false
		} as any);
		expect(u.hostKeyFingerprint).toBe('SHA256:fp');
		expect(u.gpuInfo).toBe('{"name":"A100"}');
		expect(u.systemInfo).toBe('{"os":"linux"}');
		expect(u.toolingReady).toBe(false);
	});

	it('omits optional fields when absent', () => {
		const u = mod.diagnosisToMachineUpdate({ code: 'ok', message: 'ok' } as any);
		expect('hostKeyFingerprint' in u).toBe(false);
		expect('gpuInfo' in u).toBe(false);
		expect('toolingReady' in u).toBe(false);
	});
});

describe('serializeJob', () => {
	function jobRow(over: Record<string, unknown> = {}) {
		return {
			id: 'j1',
			machineId: 'm1',
			authorId: 'u1',
			engine: 'peft',
			status: 'running',
			statusMessage: null,
			failureClass: null,
			datasetId: 'd1',
			inputKind: 'documents',
			config: '{"rank":8}',
			autoPublish: false,
			autoUploadFinetune: true,
			accountId: 'acc1',
			startedAt: '2026-01-02T00:00:00.000Z',
			finishedAt: null,
			lastHeartbeatAt: '2026-01-02T00:05:00.000Z',
			consecutiveFailures: 0,
			attempt: 1,
			logTail: 'tail',
			adapterId: null,
			adapterSize: null,
			etaSeconds: 300,
			downloadOnly: false,
			telemetry: '{"gpuUtil":80}',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
			// secret hf-token columns that must not leak
			hfTokenCipher: 'C',
			...over
		} as any;
	}

	it('parses config + telemetry json and iso timestamps', () => {
		const v = mod.serializeJob(jobRow(), 'my-box');
		expect(v.config).toEqual({ rank: 8 });
		expect(v.telemetry).toEqual({ gpuUtil: 80 });
		expect(v.machineLabel).toBe('my-box');
		expect(v.startedAt).toBe('2026-01-02T00:00:00.000Z');
		expect(v.finishedAt).toBeNull();
	});

	it('defaults config to {} on invalid json and telemetry null when absent', () => {
		const v = mod.serializeJob(jobRow({ config: 'nope', telemetry: null }));
		expect(v.config).toEqual({});
		expect(v.telemetry).toBeNull();
		expect(v.machineLabel).toBeNull();
	});

	it('does not leak hf-token columns', () => {
		const v = mod.serializeJob(jobRow()) as any;
		expect(v.hfTokenCipher).toBeUndefined();
	});
});

describe('decideProbe', () => {
	const base = { pidAlive: false, heartbeatEpoch: null, nowEpoch: 1000, sentinel: null };

	it('returns success when the sentinel succeeded', () => {
		const d = mod.decideProbe(
			{ ...base, sentinel: { status: 'success', sha256: 'abc', size: 10 } },
			0
		);
		expect(d).toEqual({ kind: 'success', sha256: 'abc', size: 10 });
	});

	it('returns reported_failure when the sentinel failed', () => {
		const d = mod.decideProbe({ ...base, sentinel: { status: 'failed', exitCode: 2 } }, 0);
		expect(d).toEqual({ kind: 'reported_failure', exitCode: 2 });
	});

	it('running when the pid is alive', () => {
		expect(mod.decideProbe({ ...base, pidAlive: true }, 0).kind).toBe('running');
	});

	it('running on a fresh heartbeat even without a live pid', () => {
		const now = 1_000_000;
		const d = mod.decideProbe({ ...base, nowEpoch: now, heartbeatEpoch: now - 5 }, 0);
		expect(d.kind).toBe('running');
	});

	it('transient when dead + stale but under the abnormal threshold', () => {
		const now = 1_000_000;
		const stale = now - 10_000; // > HEARTBEAT_STALE_MS/1000 old
		const d = mod.decideProbe({ ...base, nowEpoch: now, heartbeatEpoch: stale }, 0);
		expect(d.kind).toBe('transient');
	});

	it('abnormal once confirmations reach the threshold', () => {
		const now = 1_000_000;
		const stale = now - 10_000;
		const d = mod.decideProbe(
			{ ...base, nowEpoch: now, heartbeatEpoch: stale },
			mod.ABNORMAL_THRESHOLD - 1
		);
		expect(d.kind).toBe('abnormal');
	});
});
