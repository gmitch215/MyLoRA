import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrainingJobsStore } from '~/stores/trainingJobs';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

function job(id: string, status = 'running', extra: Record<string, unknown> = {}) {
	return { id, status, ...extra } as any;
}

describe('trainingJobs store', () => {
	it('fetch loads jobs', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ jobs: [job('a')] }));
		const store = useTrainingJobsStore();
		const res = await store.fetch();
		expect(res).toHaveLength(1);
		expect(store.jobs).toHaveLength(1);
		expect(store.loading).toBe(false);
	});

	it('fetch error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'fe' } }));
		const store = useTrainingJobsStore();
		await expect(store.fetch()).rejects.toBeTruthy();
		expect(store.error).toBe('fe');
		expect(store.loading).toBe(false);
	});

	it('fetchOne sets current and patches existing array entry', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ jobs: [job('a', 'running')] }));
		const store = useTrainingJobsStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ job: job('a', 'completed') }));
		const res = await store.fetchOne('a');
		expect(res?.status).toBe('completed');
		expect(store.current?.id).toBe('a');
		expect(store.jobs[0]!.status).toBe('completed');
	});

	it('fetchOne error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useTrainingJobsStore();
		await expect(store.fetchOne('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to load training job');
		expect(store.loading).toBe(false);
	});

	it('create returns id', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ id: 'new' }));
		const store = useTrainingJobsStore();
		const res = await store.create({} as any);
		expect(res.id).toBe('new');
	});

	it('create error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'ce' }));
		const store = useTrainingJobsStore();
		await expect(store.create({} as any)).rejects.toBeTruthy();
		expect(store.error).toBe('ce');
	});

	it('poll patches job', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ jobs: [job('a', 'running')] }));
		const store = useTrainingJobsStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ job: job('a', 'completed') }));
		const res = await store.poll('a');
		expect(res.status).toBe('completed');
		expect(store.jobs[0]!.status).toBe('completed');
	});

	it('poll error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useTrainingJobsStore();
		await expect(store.poll('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to poll training job');
	});

	it('abort patches job', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ job: job('a', 'aborted') }));
		const store = useTrainingJobsStore();
		const res = await store.abort('a');
		expect(res.status).toBe('aborted');
	});

	it('abort error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'ae' }));
		const store = useTrainingJobsStore();
		await expect(store.abort('a')).rejects.toBeTruthy();
		expect(store.error).toBe('ae');
	});

	it('retry sends normalized options and patches job', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ job: job('a', 'running') });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		const res = await store.retry('a', { force: true, sudoUser: 'u', sudoPassword: 'p' });
		expect(res.status).toBe('running');
		expect(fetchMock.mock.calls[0]![1].body).toEqual({
			force: true,
			sudoUser: 'u',
			sudoPassword: 'p'
		});
	});

	it('retry defaults options when omitted', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ job: job('a') });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		await store.retry('a');
		expect(fetchMock.mock.calls[0]![1].body).toEqual({
			force: false,
			sudoUser: undefined,
			sudoPassword: undefined
		});
	});

	it('retry error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useTrainingJobsStore();
		await expect(store.retry('a')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to retry training job');
	});

	it('remove filters job and clears current', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ jobs: [job('a'), job('b')] }));
		const store = useTrainingJobsStore();
		await store.fetch();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ job: job('a') }));
		await store.fetchOne('a');
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(undefined));
		await store.remove('a');
		expect(store.jobs.map((j) => j.id)).toEqual(['b']);
		expect(store.current).toBeNull();
	});

	it('remove error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 're' }));
		const store = useTrainingJobsStore();
		await expect(store.remove('a')).rejects.toBeTruthy();
		expect(store.error).toBe('re');
	});

	it('fetchLog returns log text', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ log: 'lines', status: 'completed' }));
		const store = useTrainingJobsStore();
		const res = await store.fetchLog('a');
		expect(res).toBe('lines');
	});

	it('uploadDataset sends text body for strings', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ datasetId: 'd', size: 1, inputKind: 'dataset', fileCount: 1 });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		const res = await store.uploadDataset('some text');
		expect(res.datasetId).toBe('d');
		expect(fetchMock.mock.calls[0]![1].body).toEqual({ text: 'some text' });
	});

	it('uploadDataset sends FormData for a single file', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ datasetId: 'd', size: 1, inputKind: 'documents', fileCount: 1 });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		await store.uploadDataset(new File(['x'], 'a.txt'));
		expect(fetchMock.mock.calls[0]![1].body).toBeInstanceOf(FormData);
	});

	it('uploadDataset sends FormData for a file array', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ datasetId: 'd', size: 2, inputKind: 'documents', fileCount: 2 });
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		await store.uploadDataset([new File(['x'], 'a.txt'), new File(['y'], 'b.txt')]);
		const body = fetchMock.mock.calls[0]![1].body as FormData;
		expect(body).toBeInstanceOf(FormData);
		expect(body.getAll('file')).toHaveLength(2);
	});

	it('uploadDataset error path', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useTrainingJobsStore();
		await expect(store.uploadDataset('t')).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to upload dataset');
	});

	it('createDataset posts empty body', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			datasetId: 'd',
			files: [],
			size: 0,
			fileCount: 0,
			inputKind: 'documents'
		});
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		const res = await store.createDataset();
		expect(res.datasetId).toBe('d');
		expect(fetchMock.mock.calls[0]![1].body).toEqual({});
	});

	it('datasetInfo fetches by id', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({
				datasetId: 'd',
				files: [],
				size: 0,
				fileCount: 0,
				inputKind: 'documents'
			})
		);
		const store = useTrainingJobsStore();
		const res = await store.datasetInfo('d');
		expect(res.datasetId).toBe('d');
	});

	it('addDatasetFiles posts FormData', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			datasetId: 'd',
			files: [],
			size: 0,
			fileCount: 1,
			inputKind: 'documents'
		});
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		await store.addDatasetFiles('d', [new File(['x'], 'a.txt')]);
		expect(fetchMock.mock.calls[0]![1].body).toBeInstanceOf(FormData);
	});

	it('addDatasetUrl posts url and extras', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			datasetId: 'd',
			files: [],
			size: 0,
			fileCount: 1,
			inputKind: 'documents'
		});
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		await store.addDatasetUrl('d', 'https://x/y.pdf', 'docs');
		expect(fetchMock.mock.calls[0]![1].body).toEqual({ url: 'https://x/y.pdf', extras: 'docs' });
	});

	it('removeDatasetFile deletes by name query', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			datasetId: 'd',
			files: [],
			size: 0,
			fileCount: 0,
			inputKind: 'documents'
		});
		vi.stubGlobal('$fetch', fetchMock);
		const store = useTrainingJobsStore();
		await store.removeDatasetFile('d', 'a.txt');
		expect(fetchMock.mock.calls[0]![1].query).toEqual({ name: 'a.txt' });
	});

	it('hfSearch returns results', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ results: [{ id: 'x' }] }));
		const store = useTrainingJobsStore();
		const res = await store.hfSearch('q');
		expect(res).toEqual([{ id: 'x' }]);
	});

	it('hfSearch swallows errors and returns empty', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue(new Error('boom')));
		const store = useTrainingJobsStore();
		const res = await store.hfSearch('q');
		expect(res).toEqual([]);
	});

	it('hfValidateDataset returns raw response', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ id: 'x', valid: true, gated: false, status: 200 })
		);
		const store = useTrainingJobsStore();
		const res = await store.hfValidateDataset('x');
		expect(res.valid).toBe(true);
	});

	it('hfValidateModel returns raw response', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ id: 'm', valid: false, gated: true, status: 401 })
		);
		const store = useTrainingJobsStore();
		const res = await store.hfValidateModel('m');
		expect(res.gated).toBe(true);
	});

	it('activeJobs filters out terminal statuses', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({
				jobs: [job('a', 'running'), job('b', 'completed'), job('c', 'queued'), job('d', 'failed')]
			})
		);
		const store = useTrainingJobsStore();
		await store.fetch();
		expect(store.activeJobs.map((j) => j.id)).toEqual(['a', 'c']);
	});
});
