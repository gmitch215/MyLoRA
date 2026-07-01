import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrainingJobs, useTrainingNotifications } from '~/composables/useTraining';

const fetchMock = vi.fn();

const toastAdd = vi.fn();
mockNuxtImport('useToast', () => () => ({ add: toastAdd }));

const job = (id: string, status: string, extra: Record<string, any> = {}) =>
	({ id, status, updatedAt: '2026-01-01T00:00:00Z', ...extra }) as any;

beforeEach(() => {
	setActivePinia(createPinia());
	fetchMock.mockReset();
	toastAdd.mockReset();
	localStorage.clear();
	vi.stubGlobal('$fetch', fetchMock);
});

describe('useTrainingJobs', () => {
	it('fetchJobs loads the job list', async () => {
		fetchMock.mockResolvedValue({ jobs: [job('j1', 'running')] });
		const { jobs, fetchJobs } = useTrainingJobs();
		const res = await fetchJobs();
		expect(res).toHaveLength(1);
		expect(jobs.value[0].id).toBe('j1');
	});

	it('activeJobs excludes terminal jobs', async () => {
		fetchMock.mockResolvedValue({
			jobs: [job('a', 'running'), job('b', 'completed'), job('c', 'failed')]
		});
		const { activeJobs, fetchJobs } = useTrainingJobs();
		await fetchJobs();
		expect(activeJobs.value.map((j: any) => j.id)).toEqual(['a']);
	});

	it('fetchJob sets current and patches the list', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [job('j1', 'running')] });
		const { current, fetchJobs, fetchJob } = useTrainingJobs();
		await fetchJobs();
		fetchMock.mockResolvedValueOnce({ job: job('j1', 'completed') });
		const res = await fetchJob('j1');
		expect(res!.status).toBe('completed');
		expect(current.value!.status).toBe('completed');
	});

	it('createJob posts the payload and returns the id', async () => {
		fetchMock.mockResolvedValue({ id: 'new-job' });
		const { createJob } = useTrainingJobs();
		const res = await createJob({ name: 'x' } as any);
		expect(res.id).toBe('new-job');
	});

	it('pollJob patches the job in place', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [job('j1', 'running')] });
		const { jobs, fetchJobs, pollJob } = useTrainingJobs();
		await fetchJobs();
		fetchMock.mockResolvedValueOnce({ job: job('j1', 'completed') });
		await pollJob('j1');
		expect(jobs.value[0].status).toBe('completed');
	});

	it('abortJob patches the job', async () => {
		fetchMock.mockResolvedValue({ job: job('j1', 'aborted') });
		const { abortJob } = useTrainingJobs();
		const res = await abortJob('j1');
		expect(res.status).toBe('aborted');
	});

	it('retryJob passes force/sudo options', async () => {
		fetchMock.mockResolvedValue({ job: job('j1', 'queued') });
		const { retryJob } = useTrainingJobs();
		await retryJob('j1', { force: true, sudoUser: 'root', sudoPassword: 'pw' });
		expect(fetchMock).toHaveBeenCalledWith('/api/training/jobs/j1/retry', {
			method: 'POST',
			body: { force: true, sudoUser: 'root', sudoPassword: 'pw' }
		});
	});

	it('uploadDataset sends plain text as a json body', async () => {
		fetchMock.mockResolvedValue({ datasetId: 'd1', size: 5, inputKind: 'dataset', fileCount: 1 });
		const { uploadDataset } = useTrainingJobs();
		const res = await uploadDataset('hello text');
		expect(res.datasetId).toBe('d1');
		expect(fetchMock).toHaveBeenCalledWith('/api/training/datasets', {
			method: 'POST',
			body: { text: 'hello text' }
		});
	});

	it('uploadDataset sends files as FormData', async () => {
		fetchMock.mockResolvedValue({ datasetId: 'd2', size: 1, inputKind: 'documents', fileCount: 2 });
		const { uploadDataset } = useTrainingJobs();
		const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
		await uploadDataset(files);
		const body = fetchMock.mock.calls[0][1].body;
		expect(body).toBeInstanceOf(FormData);
	});
});

describe('useTrainingNotifications', () => {
	it('check toasts a completed job once and increments unseen', async () => {
		// store.fetch call, then events call
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({
			events: [job('j1', 'completed', { machineLabel: 'box-1', statusMessage: 'done' })]
		});
		const { check, unseen } = useTrainingNotifications();
		await check();
		expect(toastAdd).toHaveBeenCalledTimes(1);
		expect(toastAdd.mock.calls[0][0].title).toContain('Training Completed on box-1');
		expect(unseen.value).toBe(1);
	});

	it('does not re-toast the same terminal transition', async () => {
		fetchMock.mockResolvedValue({ jobs: [] });
		const { check } = useTrainingNotifications();
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({ events: [job('j1', 'failed')] });
		await check();
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({ events: [job('j1', 'failed')] });
		await check();
		expect(toastAdd).toHaveBeenCalledTimes(1);
	});

	it('toasts an abnormal end with the abnormal title', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({ events: [job('j1', 'abnormal')] });
		const { check } = useTrainingNotifications();
		await check();
		expect(toastAdd.mock.calls[0][0].title).toContain('Training Ended Abnormally');
	});

	it('ignores non-terminal statuses', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({ events: [job('j1', 'running')] });
		const { check } = useTrainingNotifications();
		await check();
		expect(toastAdd).not.toHaveBeenCalled();
	});

	it('swallows poll errors without throwing', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockRejectedValueOnce(new Error('down'));
		const { check } = useTrainingNotifications();
		await expect(check()).resolves.toBeUndefined();
	});

	it('clearUnseen resets the counter', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({ events: [job('j1', 'completed')] });
		const { check, unseen, clearUnseen } = useTrainingNotifications();
		await check();
		expect(unseen.value).toBe(1);
		clearUnseen();
		expect(unseen.value).toBe(0);
	});

	it('persists last-seen to localStorage', async () => {
		fetchMock.mockResolvedValueOnce({ jobs: [] });
		fetchMock.mockResolvedValueOnce({ events: [job('j1', 'completed')] });
		const { check } = useTrainingNotifications();
		await check();
		const raw = localStorage.getItem('mylora:training-last-seen');
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!)).toEqual({ j1: 'completed' });
	});

	it('start primes a check and stop is safe to call', async () => {
		fetchMock.mockResolvedValue({ jobs: [] });
		const { start, stop } = useTrainingNotifications();
		start();
		stop();
		expect(fetchMock).toHaveBeenCalled();
	});
});
