import type { APIRequestContext } from '@playwright/test';
import { loginViaApi } from '../utils/auth';
import { createUser, deleteUser } from '../utils/users';
import { expect, test } from './fixtures';

// remote-training job lifecycle. dev:test runs MYLORA_MOCK_CF=1 -> isMockSsh() is on, so the ssh
// layer is the deterministic in-memory simulation keyed off the machine host prefix:
//   mock-ok.*       -> success
//   mock-fail.*     -> training reports failure (failureClass 'reported')
//   mock-abnormal.* -> the process dies without a sentinel (failureClass 'abnormal')
//   mock-gated.*    -> the probe log carries the HF gated/401 signature (failureClass 'gated')
//   mock-hfenv.*    -> preflight reports systemInfo.hfTokenEnv (the box already exports a token)
// each POST /poll advances the job by exactly one step.

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

async function createMachine(request: APIRequestContext, host: string, label: string) {
	const res = await request.post('/api/machines/create', {
		data: {
			label,
			host,
			port: 22,
			username: 'trainer',
			connectionType: 'vps',
			shared: true,
			authMethod: 'key',
			keySource: 'generated'
		}
	});
	if (!res.ok()) throw new Error(`create machine failed: ${res.status()} ${await res.text()}`);
	return (await res.json()).machine as { id: string };
}

async function uploadDataset(request: APIRequestContext) {
	const res = await request.post('/api/training/datasets', {
		data: { text: 'the quick brown fox jumps over the lazy dog. '.repeat(20) }
	});
	if (!res.ok()) throw new Error(`upload dataset failed: ${res.status()} ${await res.text()}`);
	return (await res.json()) as { datasetId: string; inputKind: 'documents' | 'dataset' };
}

async function createJob(
	request: APIRequestContext,
	machineId: string,
	datasetId: string,
	inputKind: 'documents' | 'dataset',
	over: Record<string, unknown> = {}
) {
	const res = await request.post('/api/training/jobs', {
		data: {
			machineId,
			// the dataset-upload flow is doc2lora; PEFT loads from huggingface (see createPeftJob)
			engine: 'doc2lora',
			datasetId,
			inputKind,
			config: BASE_CONFIG,
			autoPublish: false,
			autoUploadFinetune: false,
			...over
		}
	});
	return res;
}

// upload several documents at once (doc2lora parses a directory + archives natively). playwright's
// `multipart` option cannot repeat a field key, so we hand-build the body with two `file` parts.
async function uploadFiles(request: APIRequestContext, files: { name: string; text: string }[]) {
	const boundary = `----myloraTest${Date.now()}`;
	const parts: Buffer[] = [];
	for (const f of files) {
		parts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: text/plain\r\n\r\n`
			)
		);
		parts.push(Buffer.from(f.text));
		parts.push(Buffer.from('\r\n'));
	}
	parts.push(Buffer.from(`--${boundary}--\r\n`));
	const res = await request.post('/api/training/datasets', {
		headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
		data: Buffer.concat(parts)
	});
	if (!res.ok()) throw new Error(`upload files failed: ${res.status()} ${await res.text()}`);
	return (await res.json()) as {
		datasetId: string;
		size: number;
		inputKind: 'documents' | 'dataset';
		fileCount: number;
	};
}

// create an empty dataset (the picker then adds files/urls incrementally)
async function createEmptyDataset(request: APIRequestContext) {
	const res = await request.post('/api/training/datasets', { data: {} });
	if (!res.ok()) throw new Error(`create dataset failed: ${res.status()} ${await res.text()}`);
	return (await res.json()) as {
		datasetId: string;
		fileCount: number;
		inputKind: 'documents' | 'dataset';
	};
}

// append files to an existing dataset; multipart is hand-built so the `file` key can repeat
async function appendFiles(
	request: APIRequestContext,
	datasetId: string,
	files: { name: string; text: string }[]
) {
	const boundary = `----myloraTest${Date.now()}`;
	const parts: Buffer[] = [];
	for (const f of files) {
		parts.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: text/plain\r\n\r\n`
			)
		);
		parts.push(Buffer.from(f.text));
		parts.push(Buffer.from('\r\n'));
	}
	parts.push(Buffer.from(`--${boundary}--\r\n`));
	const res = await request.post(`/api/training/datasets/${datasetId}/files`, {
		headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
		data: Buffer.concat(parts)
	});
	if (!res.ok()) throw new Error(`append files failed: ${res.status()} ${await res.text()}`);
	return (await res.json()) as { datasetId: string; fileCount: number; files: { name: string }[] };
}

// create an accelerate (diffusion text-to-image LoRA) job: no datasetId; HF dataset + caption column
async function createAccelerateJob(
	request: APIRequestContext,
	machineId: string,
	configOver: Record<string, unknown> = {},
	over: Record<string, unknown> = {}
) {
	const res = await request.post('/api/training/jobs', {
		data: {
			machineId,
			engine: 'accelerate',
			inputKind: 'dataset',
			config: {
				...BASE_CONFIG,
				baseModel: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
				modelType: undefined,
				hfDataset: 'lambdalabs/naruto-blip-captions',
				captionColumn: 'text',
				resolution: 512,
				...configOver
			},
			autoPublish: false,
			autoUploadFinetune: false,
			...over
		}
	});
	return res;
}

// create a PEFT job: no datasetId; the dataset is loaded from huggingface via the config.hf* fields
async function createPeftJob(
	request: APIRequestContext,
	machineId: string,
	configOver: Record<string, unknown> = {},
	over: Record<string, unknown> = {}
) {
	const res = await request.post('/api/training/jobs', {
		data: {
			machineId,
			engine: 'peft',
			inputKind: 'dataset',
			config: {
				...BASE_CONFIG,
				baseModel: 'mistralai/Mistral-7B-Instruct-v0.2',
				modelType: undefined,
				hfDataset: 'databricks/databricks-dolly-15k',
				hfSplit: 'train',
				textField: 'response',
				...configOver
			},
			autoPublish: false,
			autoUploadFinetune: false,
			...over
		}
	});
	return res;
}

// advance a job up to `max` steps, stopping when it reaches a terminal status
async function drive(request: APIRequestContext, jobId: string, max = 6) {
	let job: any = null;
	const terminal = ['completed', 'failed', 'abnormal', 'aborted'];
	for (let i = 0; i < max; i++) {
		const res = await request.post(`/api/training/jobs/${jobId}/poll`);
		expect(res.ok()).toBe(true);
		job = (await res.json()).job;
		if (terminal.includes(job.status)) break;
	}
	return job;
}

// advance a job up to `max` steps, stopping as soon as it reaches `running` (or terminal). returns
// the job from the poll that stopped the loop so callers can inspect a live (non-terminal) run.
async function driveToRunning(request: APIRequestContext, jobId: string, max = 6) {
	let job: any = null;
	const terminal = ['completed', 'failed', 'abnormal', 'aborted'];
	for (let i = 0; i < max; i++) {
		const res = await request.post(`/api/training/jobs/${jobId}/poll`);
		expect(res.ok()).toBe(true);
		job = (await res.json()).job;
		if (job.status === 'running' || terminal.includes(job.status)) break;
	}
	return job;
}

test.describe('training jobs api', () => {
	test('happy path: mock-ok host drives to completed with an adapter row', async ({ request }) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-ok.local', 'Happy Box');
		const ds = await uploadDataset(request);
		const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
		expect(create.ok()).toBe(true);
		const { id: jobId } = await create.json();

		const job = await drive(request, jobId, 8);
		expect(job.status).toBe('completed');
		expect(job.failureClass).toBe('none');
		// a destination adapter row was created and linked
		expect(job.adapterId).toBeTruthy();
		expect(job.adapterSize).toBeGreaterThan(0);

		// the linked adapter is fetchable
		const adapter = await (await request.get(`/api/adapters/${job.adapterId}/status`)).json();
		expect(adapter.status).toBeTruthy();

		// a CF-deployable completed job can still download its config + weights (served from the promoted
		// adapter copy, not jobs/<id>/) - the artifact endpoint resolves either location
		const wRes = await request.get(`/api/training/jobs/${jobId}/artifact/weights`);
		expect(wRes.ok()).toBe(true);
		expect((await wRes.body()).length).toBeGreaterThan(0);
		const cRes = await request.get(`/api/training/jobs/${jobId}/artifact/config`);
		expect(cRes.ok()).toBe(true);

		// training telemetry: the completed run is reflected in the analytics summary (admin only)
		const summary = await (await request.get('/api/analytics/summary?range=7d')).json();
		expect(summary.training).toBeTruthy();
		expect(summary.training.started).toBeGreaterThanOrEqual(1);
		expect(summary.training.completed).toBeGreaterThanOrEqual(1);
		// a gpu bucket was recorded for the finished job
		expect(Object.keys(summary.training.byGpu).length).toBeGreaterThanOrEqual(1);

		await loginViaApi(request);
		await request.delete(`/api/machines/${machine.id}`);
	});

	test('mock-fail host -> failed with failureClass reported', async ({ request }) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-fail.local', 'Fail Box');
		const ds = await uploadDataset(request);
		const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
		const { id: jobId } = await create.json();

		const job = await drive(request, jobId, 8);
		expect(job.status).toBe('failed');
		expect(job.failureClass).toBe('reported');

		await request.delete(`/api/machines/${machine.id}`);
	});

	test('mock-abnormal host -> abnormal after repeated probes with no sentinel', async ({
		request
	}) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-abnormal.local', 'Abnormal Box');
		const ds = await uploadDataset(request);
		const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
		const { id: jobId } = await create.json();

		// poll 1 launches; the next polls accumulate failures until the abnormal threshold (3) trips
		const job = await drive(request, jobId, 8);
		expect(job.status).toBe('abnormal');
		expect(job.failureClass).toBe('abnormal');

		await request.delete(`/api/machines/${machine.id}`);
	});

	test('no machine response ever leaks ssh secrets', async ({ request }) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-ok.local', 'Secret Check');
		const list = await (await request.get('/api/machines/list')).json();
		const blob = JSON.stringify(list);
		expect(blob).not.toContain('PRIVATE KEY');
		expect(blob).not.toContain('keyCipher');
		expect(blob).not.toContain('passwordCipher');
		await request.delete(`/api/machines/${machine.id}`);
	});

	test.describe('peft engine (huggingface dataset, no upload)', () => {
		test('happy path: CF-compatible base drives to completed with an adapter row', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'PEFT Box');
			const create = await createPeftJob(request, machine.id);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');
			expect(job.engine).toBe('peft');
			// Mistral is a CF lora family -> a catalog adapter row exists, not download-only
			expect(job.downloadOnly).toBe(false);
			expect(job.adapterId).toBeTruthy();
			expect(job.adapterSize).toBeGreaterThan(0);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('download-only: a non-CF base completes with downloadable artifacts and no adapter row', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'PEFT DL Box');
			// gpt2 -> detectModelType null -> download-only (no catalog row, artifacts under jobs/<id>/)
			const create = await createPeftJob(request, machine.id, { baseModel: 'gpt2' });
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');
			expect(job.downloadOnly).toBe(true);
			expect(job.adapterId).toBeNull();

			// the artifacts are fetchable from the job-scoped download endpoint
			const weights = await request.get(`/api/training/jobs/${jobId}/artifact/weights`);
			expect(weights.ok()).toBe(true);
			const config = await request.get(`/api/training/jobs/${jobId}/artifact/config`);
			expect(config.ok()).toBe(true);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('autoUpload on a non-CF base is rejected at create (not Cloudflare-deployable)', async ({
			request
		}) => {
			// admin has canPublish, so this is the model-compat check, not the capability check
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'PEFT Gate Box');
			const res = await createPeftJob(
				request,
				machine.id,
				{ baseModel: 'gpt2' },
				{ autoUploadFinetune: true }
			);
			expect(res.status()).toBe(400);
			expect((await res.text()).toLowerCase()).toContain('cloudflare-deployable');

			await request.delete(`/api/machines/${machine.id}`);
		});

		test('a peft job without a hfDataset is rejected at create', async ({ request }) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'PEFT NoDS Box');
			const res = await createPeftJob(request, machine.id, { hfDataset: '' });
			expect(res.status()).toBe(400);

			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('huggingface dataset picker endpoints (mocked)', () => {
		test('search returns a non-empty results array', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/search?q=dolly');
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(Array.isArray(body.results)).toBe(true);
			expect(body.results.length).toBeGreaterThan(0);
			expect(body.results[0].id).toContain('dolly');
		});

		test('an empty query returns no results', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/search?q=');
			expect(res.ok()).toBe(true);
			expect((await res.json()).results).toEqual([]);
		});

		test('dataset validate: a normal id is valid', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/dataset?id=foo/bar');
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.valid).toBe(true);
			expect(body.gated).toBe(false);
		});

		test('dataset validate: a missing id is invalid', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/dataset?id=foo/missing-dataset');
			expect(res.ok()).toBe(true);
			expect((await res.json()).valid).toBe(false);
		});

		test('dataset validate: a gated id reports gated', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/dataset?id=foo/gated-set');
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.valid).toBe(true);
			expect(body.gated).toBe(true);
		});
	});

	test.describe('doc2lora multi-file upload', () => {
		test('uploads two files then drives a doc2lora job to completed', async ({ request }) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Doc2lora Multi Box');

			const ds = await uploadFiles(request, [
				{ name: 'doc-one.txt', text: 'the quick brown fox. '.repeat(20) },
				{ name: 'doc-two.txt', text: 'jumps over the lazy dog. '.repeat(20) }
			]);
			expect(ds.fileCount).toBe(2);
			// two plain-text docs read as a documents bundle (only a single tabular file is a dataset)
			expect(ds.inputKind).toBe('documents');

			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind, {
				engine: 'doc2lora'
			});
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');
			expect(job.engine).toBe('doc2lora');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('dataset picker endpoints (create / append / list / delete / url)', () => {
		test('builds a dataset incrementally then drives a doc2lora job to completed', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Dataset Picker Box');

			// empty create -> 0 files
			const created = await createEmptyDataset(request);
			expect(created.datasetId).toBeTruthy();
			expect(created.fileCount).toBe(0);
			const datasetId = created.datasetId;

			// append two files -> 2
			const appended = await appendFiles(request, datasetId, [
				{ name: 'a.txt', text: 'the quick brown fox. '.repeat(20) },
				{ name: 'b.txt', text: 'jumps over the lazy dog. '.repeat(20) }
			]);
			expect(appended.fileCount).toBe(2);

			// list -> two files
			const listed = await (await request.get(`/api/training/datasets/${datasetId}`)).json();
			expect(listed.files.length).toBe(2);
			const oneName = listed.files[0].name as string;

			// delete one -> 1
			const afterDelete = await (
				await request.delete(
					`/api/training/datasets/${datasetId}/files?name=${encodeURIComponent(oneName)}`
				)
			).json();
			expect(afterDelete.fileCount).toBe(1);

			// add by url (mock stores a synthetic file) -> 2 again
			const afterUrl = await (
				await request.post(`/api/training/datasets/${datasetId}/url`, {
					data: { url: 'https://example.com/data.txt' }
				})
			).json();
			expect(afterUrl.fileCount).toBe(2);

			// the assembled dataset trains a doc2lora job to completion
			const create = await createJob(request, machine.id, datasetId, 'documents', {
				engine: 'doc2lora'
			});
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();
			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');
			expect(job.engine).toBe('doc2lora');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('accelerate engine (diffusion text-to-image LoRA, download-only)', () => {
		test('drives to completed with downloadable weights and no adapter row', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Accelerate Box');
			const create = await createAccelerateJob(request, machine.id);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');
			expect(job.engine).toBe('accelerate');
			// diffusion LoRA is never CF-deployable -> download-only, no catalog adapter row
			expect(job.downloadOnly).toBe(true);
			expect(job.adapterId).toBeNull();

			// the weights artifact is fetchable from the job-scoped download endpoint
			const weights = await request.get(`/api/training/jobs/${jobId}/artifact/weights`);
			expect(weights.ok()).toBe(true);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('autoUpload on an accelerate job is rejected at create (not Cloudflare-deployable)', async ({
			request
		}) => {
			// admin has canPublish, so this is the model-compat check, not the capability check
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Accelerate Gate Box');
			const res = await createAccelerateJob(request, machine.id, {}, { autoUploadFinetune: true });
			expect(res.status()).toBe(400);
			expect((await res.text()).toLowerCase()).toContain('cloudflare-deployable');

			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('auto-tune to detected VRAM', () => {
		test('a low-vram GPU enables 4-bit and records the autotune log', async ({ request }) => {
			await loginViaApi(request);
			// mock-lowvram preflight reports a 12000MB GPU -> a 7B/8B base needs QLoRA to fit
			const machine = await createMachine(request, 'mock-lowvram.local', 'Low VRAM Box');
			const ds = await uploadDataset(request);
			// a doc2lora 7B/8B CF base with full-precision + batch>1 so auto-tune must act
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind, {
				engine: 'doc2lora',
				config: { ...BASE_CONFIG, load4bit: false, batchSize: 4 }
			});
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');
			// the durable proof of auto-tune: the persisted config now has 4-bit enabled + batch dropped
			// to fit 12000MB (the transient [autotune] log line is overwritten by the live train log)
			expect(job.config.load4bit).toBe(true);
			expect(job.config.batchSize).toBe(1);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('a failed preflight records the verbose detail in the job log', async ({ request }) => {
			await loginViaApi(request);
			// mock-nogpu reports no GPU; a cuda-device job fails preflight with the detail logged
			const machine = await createMachine(request, 'mock-nogpu.local', 'No GPU Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind, {
				config: { ...BASE_CONFIG, device: 'cuda' }
			});
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('failed');
			expect(job.failureClass).toBe('preflight');
			// the verbose preflight log is present (no more empty "No log output")
			expect((job.logTail || '').toLowerCase()).toContain('[preflight]');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('training job history + restart + logs', () => {
		test('DELETE removes the job: GET 404s and it drops out of the list', async ({ request }) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Delete Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');

			const del = await request.delete(`/api/training/jobs/${jobId}`);
			expect(del.ok()).toBe(true);
			expect(await del.json()).toEqual({ ok: true });

			// the row is gone: a direct fetch 404s and the list no longer carries it
			const after = await request.get(`/api/training/jobs/${jobId}`);
			expect(after.status()).toBe(404);
			const list = await (await request.get('/api/training/jobs/list')).json();
			expect((list.jobs as { id: string }[]).some((j) => j.id === jobId)).toBe(false);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('GET log returns the train log string, and ?download=1 attaches it', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Log Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			// a freshly created job is non-terminal with a machine -> the mock fetchRemoteLog supplies a log
			const res = await request.get(`/api/training/jobs/${jobId}/log`);
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(typeof body.log).toBe('string');
			expect(body.log.length).toBeGreaterThan(0);
			expect(body.log).toContain('[mock] full training log');
			expect(body.status).toBeTruthy();

			// the download variant returns the raw text with an attachment disposition header
			const dl = await request.get(`/api/training/jobs/${jobId}/log?download=1`);
			expect(dl.ok()).toBe(true);
			expect(dl.headers()['content-disposition']).toContain('attachment');
			expect(typeof (await dl.text())).toBe('string');
			expect((await dl.text()).length).toBeGreaterThan(0);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('retry: force is required while non-terminal, and force re-queues to a live status', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Retry Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			// poll once so the job is launched + non-terminal, then a plain retry must be refused
			const after = await (await request.post(`/api/training/jobs/${jobId}/poll`)).json();
			const nonTerminal = [
				'queued',
				'provisioning',
				'launching',
				'running',
				'syncing',
				'verifying'
			];
			if (nonTerminal.includes(after.job.status)) {
				const refused = await request.post(`/api/training/jobs/${jobId}/retry`, { data: {} });
				expect(refused.status()).toBe(409);
			}

			// force re-queues even a live job (it is killed first) -> a fresh non-terminal status
			const forced = await request.post(`/api/training/jobs/${jobId}/retry`, {
				data: { force: true }
			});
			expect(forced.ok()).toBe(true);
			const { job } = await forced.json();
			expect(['queued', 'provisioning', 'launching', 'running']).toContain(job.status);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('useSudo persists on the job config but the sudoPassword never round-trips', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Sudo Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind, {
				config: { ...BASE_CONFIG, useSudo: true },
				sudoPassword: 'super-secret-pw'
			});
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const res = await request.get(`/api/training/jobs/${jobId}`);
			expect(res.ok()).toBe(true);
			const { job } = await res.json();
			expect(job.config.useSudo).toBe(true);
			// the password is single-use / never persisted: it must not appear anywhere in the view
			expect(JSON.stringify(job)).not.toContain('super-secret-pw');
			expect(JSON.stringify(job)).not.toContain('sudoPassword');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('publish gating', () => {
		let dev: Awaited<ReturnType<typeof createUser>>;

		test.beforeAll(async ({ request }) => {
			dev = await createUser(request, { role: 'developer' });
		});

		test.afterAll(async ({ request }) => {
			await loginViaApi(request);
			if (dev) await deleteUser(request, dev.id);
		});

		test('a developer without canPublish cannot request autoPublish / autoUploadFinetune', async ({
			request
		}) => {
			// admin owns a shared machine the developer may use
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Shared Train Box');

			await loginViaApi(request, dev);
			const ds = await uploadDataset(request);
			const res = await createJob(request, machine.id, ds.datasetId, ds.inputKind, {
				autoPublish: true,
				autoUploadFinetune: true
			});
			// canPublish is required to auto-publish; a default developer lacks it
			expect(res.status()).toBe(403);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('huggingface gated access', () => {
		test('mock-gated host -> failed with failureClass gated and an access statusMessage', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-gated.local', 'Gated Box');
			// peft loads from HF; a gated base model is the realistic trigger for the 401 signature
			const create = await createPeftJob(request, machine.id, {
				baseModel: 'meta-llama/Llama-2-7b-chat-hf'
			});
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('failed');
			expect(job.failureClass).toBe('gated');
			// the message tells the user it is a HuggingFace gated-access problem (with the repo link)
			const msg = (job.statusMessage || '').toLowerCase();
			expect(msg).toContain('huggingface');
			expect(msg).toContain('gated');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});

		test('mock-hfenv host: systemInfo.hfTokenEnv round-trips through Test Connection + list', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-hfenv.local', 'HF Env Box');

			// Test Connection runs preflight; the mock box reports the token env var names it exports
			const test = await request.post(`/api/machines/${machine.id}/test`);
			expect(test.ok()).toBe(true);
			const tested = await test.json();
			expect(tested.diagnosis.systemInfo.hfTokenEnv).toEqual([
				'HF_API_KEY',
				'HUGGINGFACE_API_TOKEN'
			]);
			// the persisted machine view carries the same info
			expect(tested.machine.systemInfo.hfTokenEnv).toEqual(['HF_API_KEY', 'HUGGINGFACE_API_TOKEN']);

			// and it survives the list round-trip (parsed back out of the stored json)
			const list = await (await request.get('/api/machines/list')).json();
			const row = (list.machines as { id: string; systemInfo?: { hfTokenEnv?: string[] } }[]).find(
				(m) => m.id === machine.id
			);
			expect(row?.systemInfo?.hfTokenEnv).toEqual(['HF_API_KEY', 'HUGGINGFACE_API_TOKEN']);

			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('huggingface model validate endpoint (mocked)', () => {
		test('a gated model id reports gated with a 401 status', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get(
				`/api/training/hf/model?id=${encodeURIComponent('meta-llama/Llama-2-7b-chat-hf')}`
			);
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.valid).toBe(true);
			expect(body.gated).toBe(true);
			expect(body.status).toBe(401);
		});

		test('a normal model id is valid and not gated', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/model?id=gpt2');
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.valid).toBe(true);
			expect(body.gated).toBe(false);
			expect(body.status).toBe(200);
		});

		test('a missing model id is invalid with a 404 status', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/model?id=org/missing-model');
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(body.valid).toBe(false);
			expect(body.status).toBe(404);
		});

		test('a blank model id is a 400', async ({ request }) => {
			await loginViaApi(request);
			const res = await request.get('/api/training/hf/model?id=');
			expect(res.status()).toBe(400);
		});

		test('requires auth: an unauthenticated request is rejected (401/403)', async ({ request }) => {
			// this test does NOT log in first, so the request fixture carries no session
			const res = await request.get('/api/training/hf/model?id=gpt2');
			expect([401, 403]).toContain(res.status());
		});
	});

	test.describe('live telemetry on a running job', () => {
		test('a running job round-trips a numeric telemetry sample through GET', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Telemetry Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			// poll one step at a time; capture any non-null telemetry sample seen while still running.
			// the mock attaches telemetry to its running probe, so the live GET reflects the same shape.
			const terminal = ['completed', 'failed', 'abnormal', 'aborted'];
			let sawRunning = false;
			let tel: any = null;
			for (let i = 0; i < 8; i++) {
				const poll = await request.post(`/api/training/jobs/${jobId}/poll`);
				expect(poll.ok()).toBe(true);
				const polled = (await poll.json()).job;
				if (polled.status === 'running') {
					sawRunning = true;
					// read the persisted view (no live probe) so we assert what actually round-trips
					const view = await (await request.get(`/api/training/jobs/${jobId}`)).json();
					if (view.job.telemetry) tel = view.job.telemetry;
				}
				if (tel || terminal.includes(polled.status)) break;
			}

			// the first running probe persists a telemetry sample, so it must round-trip through the view
			expect(sawRunning).toBe(true);
			expect(tel).toBeTruthy();
			expect(typeof tel.cpuPct).toBe('number');
			expect(typeof tel.vramUsedMb).toBe('number');
			expect(typeof tel.vramTotalMb).toBe('number');
			expect(typeof tel.outputBytes).toBe('number');
			expect(tel.vramUsedMb).toBeLessThanOrEqual(tel.vramTotalMb);

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('abort a running job', () => {
		test('POST /abort ends the job as aborted with failureClass aborted', async ({ request }) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Abort Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			// drive to a live, non-terminal status so the abort has a running job to kill
			const running = await driveToRunning(request, jobId, 8);
			expect(['running', 'provisioning', 'launching', 'syncing']).toContain(running.status);

			const abort = await request.post(`/api/training/jobs/${jobId}/abort`);
			expect(abort.ok()).toBe(true);
			const { job } = await abort.json();
			expect(job.status).toBe('aborted');
			expect(job.failureClass).toBe('aborted');
			expect(job.finishedAt).toBeTruthy();

			// the terminal status survives the read-back
			const view = await (await request.get(`/api/training/jobs/${jobId}`)).json();
			expect(view.job.status).toBe('aborted');
			expect(view.job.failureClass).toBe('aborted');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('training jobs events feed', () => {
		test('GET /jobs/events returns an events array reflecting a created job', async ({
			request
		}) => {
			await loginViaApi(request);
			const machine = await createMachine(request, 'mock-ok.local', 'Events Box');
			const ds = await uploadDataset(request);
			const create = await createJob(request, machine.id, ds.datasetId, ds.inputKind);
			expect(create.ok()).toBe(true);
			const { id: jobId } = await create.json();

			const job = await drive(request, jobId, 8);
			expect(job.status).toBe('completed');

			// events is a collection feed (since-cursor), not a per-job route; the finished job appears
			const res = await request.get('/api/training/jobs/events');
			expect(res.ok()).toBe(true);
			const body = await res.json();
			expect(Array.isArray(body.events)).toBe(true);
			const ev = (body.events as { id: string }[]).find((e) => e.id === jobId);
			expect(ev).toBeTruthy();
			expect(ev!.status).toBe('completed');
			expect(ev!.machineLabel).toBe('Events Box');
			expect(typeof ev!.updatedAt).toBe('string');

			await loginViaApi(request);
			await request.delete(`/api/machines/${machine.id}`);
		});
	});

	test.describe('jobs/list machine label resolution (batched lookup)', () => {
		test('each job carries the label of its own machine', async ({ request }) => {
			await loginViaApi(request);
			// two machines with distinct labels + a job on each: the batched label map must not cross wires
			const m1 = await createMachine(request, 'mock-ok.local', 'List Label Alpha');
			const m2 = await createMachine(request, 'mock-ok.local', 'List Label Beta');

			const ds1 = await uploadDataset(request);
			const c1 = await createJob(request, m1.id, ds1.datasetId, ds1.inputKind);
			expect(c1.ok()).toBe(true);
			const { id: job1 } = await c1.json();

			const ds2 = await uploadDataset(request);
			const c2 = await createJob(request, m2.id, ds2.datasetId, ds2.inputKind);
			expect(c2.ok()).toBe(true);
			const { id: job2 } = await c2.json();

			const list = await (await request.get('/api/training/jobs/list')).json();
			const rows = list.jobs as { id: string; machineLabel: string | null }[];
			const r1 = rows.find((j) => j.id === job1);
			const r2 = rows.find((j) => j.id === job2);
			expect(r1?.machineLabel).toBe('List Label Alpha');
			expect(r2?.machineLabel).toBe('List Label Beta');

			await loginViaApi(request);
			await request.delete(`/api/machines/${m1.id}`);
			await request.delete(`/api/machines/${m2.id}`);
		});
	});
});
