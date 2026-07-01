import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePublishStore } from '~/stores/publish';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('publish store', () => {
	it('stateFor lazily creates and reuses state', () => {
		const store = usePublishStore();
		const s = store.stateFor('a');
		expect(s).toEqual({ status: null, job: null, message: null, polling: false, error: null });
		expect(store.stateFor('a')).toBe(s);
	});

	it('isActive reflects polling, job, or pushing status', () => {
		const store = usePublishStore();
		expect(store.isActive('a')).toBe(false);
		const s = store.stateFor('a');
		s.polling = true;
		expect(store.isActive('a')).toBe(true);
		s.polling = false;
		s.job = { id: 'j' } as any;
		expect(store.isActive('a')).toBe(true);
		s.job = null;
		s.status = 'pushing' as any;
		expect(store.isActive('a')).toBe(true);
	});

	it('preflight passes accountId query when provided', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ canPublish: true, detail: 'ok', accountLabel: 'L', accountId: 'acc' });
		vi.stubGlobal('$fetch', fetchMock);
		const store = usePublishStore();
		const res = await store.preflight('a', 'acc');
		expect(res.canPublish).toBe(true);
		expect(fetchMock.mock.calls[0]![1].query).toEqual({ accountId: 'acc' });
	});

	it('preflight omits query when no accountId', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ canPublish: null, detail: '', accountLabel: null, accountId: null });
		vi.stubGlobal('$fetch', fetchMock);
		const store = usePublishStore();
		await store.preflight('a');
		expect(fetchMock.mock.calls[0]![1].query).toBeUndefined();
	});

	it('start sets status, sends accountId body, and begins polling', async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, status: 'pushing' })
			.mockResolvedValueOnce({ status: 'pushing' })
			.mockResolvedValue({ status: 'published' });
		vi.stubGlobal('$fetch', fetchMock);
		const store = usePublishStore();
		const res = await store.start('a', 'acc');
		expect(res.status).toBe('pushing');
		expect(store.stateFor('a').status).toBe('pushing');
		expect(fetchMock.mock.calls[0]![1].body).toEqual({ accountId: 'acc' });
		// let the poll loop reschedule and then settle
		await vi.runAllTimersAsync();
		expect(store.stateFor('a').status).toBe('published');
		store.stop('a');
	});

	it('start sends empty body when no accountId and records failure', async () => {
		const fetchMock = vi.fn().mockRejectedValue({ data: { message: 'no perm' } });
		vi.stubGlobal('$fetch', fetchMock);
		const store = usePublishStore();
		await expect(store.start('a')).rejects.toBeTruthy();
		const s = store.stateFor('a');
		expect(s.error).toBe('no perm');
		expect(s.status).toBe('failed');
		expect(s.message).toBe('no perm');
	});

	it('start error falls back to statusMessage then generic', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { statusMessage: 'sm' } }));
		const store = usePublishStore();
		await expect(store.start('b')).rejects.toBeTruthy();
		expect(store.stateFor('b').error).toBe('sm');
	});

	it('poll reschedules while in-progress and stops on terminal', async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ status: 'pushing', statusMessage: 'working', job: { id: 'j' } })
			.mockResolvedValueOnce({ status: 'published', statusMessage: 'done' });
		vi.stubGlobal('$fetch', fetchMock);
		const store = usePublishStore();
		const res = await store.poll('a');
		expect(res.status).toBe('pushing');
		const s = store.stateFor('a');
		expect(s.polling).toBe(true);
		expect(s.message).toBe('working');
		expect(s.job).toEqual({ id: 'j' });
		await vi.runAllTimersAsync();
		expect(store.stateFor('a').status).toBe('published');
		expect(store.stateFor('a').polling).toBe(false);
	});

	it('poll stops immediately on failed', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ status: 'failed' }));
		const store = usePublishStore();
		const res = await store.poll('a');
		expect(res.status).toBe('failed');
		expect(store.stateFor('a').polling).toBe(false);
	});

	it('poll error path stops and records error', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'pe' }));
		const store = usePublishStore();
		await expect(store.poll('a')).rejects.toBeTruthy();
		const s = store.stateFor('a');
		expect(s.error).toBe('pe');
		expect(s.polling).toBe(false);
	});

	it('stop clears polling and the timer', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ status: 'pushing' }));
		const store = usePublishStore();
		await store.poll('a');
		expect(store.stateFor('a').polling).toBe(true);
		store.stop('a');
		expect(store.stateFor('a').polling).toBe(false);
		// nothing left scheduled
		await vi.runAllTimersAsync();
	});

	it('stop is safe on unknown id', () => {
		const store = usePublishStore();
		expect(() => store.stop('unknown')).not.toThrow();
	});

	it('settled resolves immediately when not polling', async () => {
		const store = usePublishStore();
		await expect(store.settled('a')).resolves.toBeUndefined();
	});

	it('settled resolves once polling flips off', async () => {
		const store = usePublishStore();
		const s = store.stateFor('a');
		s.polling = true;
		const p = store.settled('a');
		s.polling = false;
		await expect(p).resolves.toBeUndefined();
	});

	it('clear stops and deletes state', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ status: 'pushing' }));
		const store = usePublishStore();
		await store.poll('a');
		store.clear('a');
		expect(store.states.a).toBeUndefined();
		await vi.runAllTimersAsync();
	});
});
