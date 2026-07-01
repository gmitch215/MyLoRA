import { loginViaApi } from '../utils/auth';
import { createUser, deleteUser } from '../utils/users';
import { expect, test } from './fixtures';

// remote-training machine endpoints. the dev:test server runs with MYLORA_MOCK_CF=1 which
// auto-enables the deterministic ssh mock (isMockSsh); diagnoses are keyed off the host prefix.

// minimal doc2lora training config (mirrors training.spec.ts BASE_CONFIG) for the 'running' test
const BASE_CONFIG = {
	baseModel: '@cf/meta/llama-3.1-8b-instruct',
	modelType: 'llama' as const,
	rank: 8,
	loraAlpha: 16,
	loraDropout: 0.1,
	epochs: 1,
	learningRate: 0.0005,
	maxLength: 256,
	batchSize: 2,
	gradientAccumulationSteps: 1,
	load4bit: false,
	device: 'cuda' as const,
	targetModules: [],
	abortOnError: true
};

test.describe('machines api', () => {
	test('create with a generated key returns the public key once and a redacted machine', async ({
		request
	}) => {
		await loginViaApi(request);
		const res = await request.post('/api/machines/create', {
			data: {
				label: 'Gen Key Box',
				host: 'mock-ok.local',
				port: 22,
				username: 'trainer',
				connectionType: 'vps',
				shared: true,
				authMethod: 'key',
				keySource: 'generated'
			}
		});
		expect(res.ok()).toBe(true);
		const body = await res.json();
		// the public key is surfaced once at creation so the user can install it
		expect(typeof body.publicKey).toBe('string');
		expect(body.publicKey).toMatch(/^ssh-ed25519 /);

		const machine = body.machine;
		expect(machine.id).toBeTruthy();
		expect(machine.label).toBe('Gen Key Box');
		expect(machine.keySource).toBe('generated');
		expect(machine.keyLast4).toBeTruthy();
		// no secret material is ever serialized
		const serialized = JSON.stringify(machine);
		expect(serialized).not.toContain('PRIVATE KEY');
		expect(machine.keyCipher).toBeUndefined();
		expect(machine.keyDekCipher).toBeUndefined();
		expect(machine.passwordCipher).toBeUndefined();

		await request.delete(`/api/machines/${machine.id}`);
	});

	test('list returns redacted machines with no secrets', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'List Box',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const list = await (await request.get('/api/machines/list')).json();
		expect(Array.isArray(list.machines)).toBe(true);
		const found = list.machines.find((m: any) => m.id === created.machine.id);
		expect(found).toBeTruthy();
		expect(JSON.stringify(list.machines)).not.toContain('PRIVATE KEY');
		expect(found.keyCipher).toBeUndefined();

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('test connection diagnoses ok for a healthy mock host', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'OK Box',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const res = await request.post(`/api/machines/${created.machine.id}/test`);
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body.diagnosis.ok).toBe(true);
		expect(body.diagnosis.code).toBe('ok');
		// preflight surfaces a gpu + tooling readiness for a healthy host
		expect(body.diagnosis.gpuInfo).toBeTruthy();
		expect(body.machine.healthStatus).toBe('ok');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('test connection diagnoses auth failure for a mock-auth host', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'Auth Fail Box',
					host: 'mock-auth.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const res = await request.post(`/api/machines/${created.machine.id}/test`);
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body.diagnosis.ok).toBe(false);
		expect(body.diagnosis.code).toBe('auth');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('update mutates label + shared and keeps secrets redacted', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'Before',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: false,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const res = await request.patch(`/api/machines/${created.machine.id}`, {
			data: { label: 'After', shared: true }
		});
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body.machine.label).toBe('After');
		expect(body.machine.shared).toBe(true);
		expect(JSON.stringify(body.machine)).not.toContain('PRIVATE KEY');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('delete removes the machine', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'To Delete',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const del = await request.delete(`/api/machines/${created.machine.id}`);
		expect(del.ok()).toBe(true);

		const list = await (await request.get('/api/machines/list')).json();
		expect(list.machines.find((m: any) => m.id === created.machine.id)).toBeFalsy();
	});

	test('test connection populates gpu + systemInfo and leaks no secrets', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'GPU Box',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const res = await request.post(`/api/machines/${created.machine.id}/test`);
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(body.diagnosis.code).toBe('ok');

		const m = body.machine;
		expect(typeof m.gpuInfo.name).toBe('string');
		expect(m.gpuInfo.vramMb).toBeGreaterThan(0);
		expect(m.systemInfo.os).toBeTruthy();
		expect(m.systemInfo.cpuCores).toBeTruthy();
		expect(m.systemInfo.diskType).toBeTruthy();
		// preflight detail must never carry secret material
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain('PRIVATE KEY');
		expect(serialized).not.toMatch(/"\w*[Cc]ipher"/);
		expect(serialized).not.toContain('privateKey');
		expect(serialized).not.toContain('password');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('derived health is at_capacity for a near-full gpu', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'At Capacity Box',
					host: 'mock-atcap.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		// test stores the near-full gpuInfo onto the machine
		await request.post(`/api/machines/${created.machine.id}/test`);

		const list = await (await request.get('/api/machines/list')).json();
		const found = list.machines.find((m: any) => m.id === created.machine.id);
		expect(found.healthStatus).toBe('at_capacity');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('derived health is running when a non-terminal job is on the machine', async ({
		request
	}) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'Running Box',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		// the dataset-upload flow is doc2lora (see training.spec.ts)
		const ds = await (
			await request.post('/api/training/datasets', {
				data: { text: 'the quick brown fox jumps over the lazy dog. '.repeat(20) }
			})
		).json();
		const jobRes = await request.post('/api/training/jobs', {
			data: {
				machineId: created.machine.id,
				engine: 'doc2lora',
				datasetId: ds.datasetId,
				inputKind: ds.inputKind,
				config: BASE_CONFIG,
				autoPublish: false,
				autoUploadFinetune: false
			}
		});
		expect(jobRes.ok()).toBe(true);

		// a queued (non-terminal) job marks the machine busy -> running
		const list = await (await request.get('/api/machines/list')).json();
		const found = list.machines.find((m: any) => m.id === created.machine.id);
		expect(found.healthStatus).toBe('running');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('prepare kicks off a background prepare and marks the machine preparing', async ({
		request
	}) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'Prepare Box',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();

		const res = await request.post(`/api/machines/${created.machine.id}/prepare`, {
			data: { doc2loraExtras: 'docs', load4bit: false }
		});
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(typeof body.message).toBe('string');
		expect(body.machine.systemInfo.prepared.status).toBe('preparing');

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test.describe('connection diagnoses (edge cases)', () => {
		// host prefix -> { diagnosis.code, stored healthStatus } per remote.ts + diagnosisToMachineUpdate
		const cases = [
			{ host: 'mock-dns.local', code: 'dns', health: 'unreachable' },
			{ host: 'mock-timeout.local', code: 'timeout', health: 'unreachable' },
			{ host: 'mock-unreachable.local', code: 'refused', health: 'unreachable' }
		];
		for (const c of cases) {
			test(`${c.host} diagnoses ${c.code} and stores ${c.health}`, async ({ request }) => {
				await loginViaApi(request);
				const created = await (
					await request.post('/api/machines/create', {
						data: {
							label: `Edge ${c.code}`,
							host: c.host,
							username: 'trainer',
							shared: true,
							authMethod: 'key',
							keySource: 'generated'
						}
					})
				).json();

				const res = await request.post(`/api/machines/${created.machine.id}/test`);
				expect(res.ok()).toBe(true);
				const body = await res.json();
				expect(body.diagnosis.ok).toBe(false);
				expect(body.diagnosis.code).toBe(c.code);
				expect(body.machine.healthStatus).toBe(c.health);

				await request.delete(`/api/machines/${created.machine.id}`);
			});
		}
	});

	test('rotate-key issues a new public key and keeps the machine redacted', async ({ request }) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'Rotate Box',
					host: 'mock-ok.local',
					username: 'trainer',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();
		const firstKey = created.publicKey as string;
		expect(typeof firstKey).toBe('string');

		const res = await request.post(`/api/machines/${created.machine.id}/rotate-key`);
		expect(res.ok()).toBe(true);
		const body = await res.json();
		expect(typeof body.publicKey).toBe('string');
		expect(body.publicKey).not.toBe(firstKey);
		expect(body.machine.keyLast4).toBeTruthy();
		const serialized = JSON.stringify(body.machine);
		expect(serialized).not.toContain('PRIVATE KEY');
		expect(body.machine.keyCipher).toBeUndefined();

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test('tunnel self-report updates the stored endpoint and validates the token + body', async ({
		request
	}) => {
		await loginViaApi(request);
		const created = await (
			await request.post('/api/machines/create', {
				data: {
					label: 'Tunnel Box',
					host: 'mock-ok.local',
					username: 'trainer',
					connectionType: 'tunnel',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			})
		).json();
		const token = created.selfReportToken as string;
		expect(typeof token).toBe('string');

		const report = await request.post('/api/machines/tunnel-report', {
			data: { token, host: 'new-host.example.com', port: 2222 }
		});
		expect(report.ok()).toBe(true);
		expect(await report.json()).toEqual({ ok: true });

		const list = await (await request.get('/api/machines/list')).json();
		const found = list.machines.find((m: any) => m.id === created.machine.id);
		expect(found.host).toBe('new-host.example.com');
		expect(found.port).toBe(2222);

		// an unknown token -> 404
		const unknown = await request.post('/api/machines/tunnel-report', {
			data: { token: 'x'.repeat(64), host: 'h.example.com', port: 22 }
		});
		expect(unknown.status()).toBe(404);

		// a missing port -> 400 (zod validation)
		const invalid = await request.post('/api/machines/tunnel-report', {
			data: { token, host: 'h.example.com' }
		});
		expect(invalid.status()).toBe(400);

		await request.delete(`/api/machines/${created.machine.id}`);
	});

	test.describe('permission gating', () => {
		let dev: Awaited<ReturnType<typeof createUser>>;

		test.beforeAll(async ({ request }) => {
			dev = await createUser(request, { role: 'developer' });
		});

		test.afterAll(async ({ request }) => {
			if (dev) await deleteUser(request, dev.id);
		});

		test('a developer can create a personal machine but cannot create a shared one', async ({
			request
		}) => {
			await loginViaApi(request, dev);

			// personal (shared:false) is allowed for canTrain developers
			const own = await request.post('/api/machines/create', {
				data: {
					label: 'Dev Personal',
					host: 'mock-ok.local',
					username: 'dev',
					shared: false,
					authMethod: 'key',
					keySource: 'generated'
				}
			});
			expect(own.ok()).toBe(true);
			const ownBody = await own.json();

			// creating a SHARED machine needs canManageMachines, which a developer lacks
			const sharedRes = await request.post('/api/machines/create', {
				data: {
					label: 'Dev Shared',
					host: 'mock-ok.local',
					username: 'dev',
					shared: true,
					authMethod: 'key',
					keySource: 'generated'
				}
			});
			expect(sharedRes.status()).toBe(403);

			// cleanup as admin
			await loginViaApi(request);
			await request.delete(`/api/machines/${ownBody.machine.id}`);
		});

		test("a developer cannot manage another owner's machine", async ({ request }) => {
			// admin creates a machine it owns
			await loginViaApi(request);
			const adminMachine = await (
				await request.post('/api/machines/create', {
					data: {
						label: 'Admin Owned',
						host: 'mock-ok.local',
						username: 'root',
						shared: false,
						authMethod: 'key',
						keySource: 'generated'
					}
				})
			).json();

			// the developer must not be able to update or delete it
			await loginViaApi(request, dev);
			const upd = await request.patch(`/api/machines/${adminMachine.machine.id}`, {
				data: { label: 'Hijacked' }
			});
			expect(upd.status()).toBe(403);
			const del = await request.delete(`/api/machines/${adminMachine.machine.id}`);
			expect(del.status()).toBe(403);

			// cleanup as admin
			await loginViaApi(request);
			await request.delete(`/api/machines/${adminMachine.machine.id}`);
		});
	});
});
