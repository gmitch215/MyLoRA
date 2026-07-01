import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadStore } from '~/stores/upload';

const realXHR = globalThis.XMLHttpRequest;

// fake XHR so uploadWithProgress can be driven deterministically; scenario is set per test
type Scenario = {
	status: number;
	responseText?: string;
	progress?: number;
	networkError?: boolean;
};
let scenario: Scenario = { status: 200, responseText: '{}' };

class FakeXHR {
	upload: { onprogress?: (ev: any) => void } = {};
	onload?: () => void;
	onerror?: () => void;
	status = 0;
	responseText = '';
	open() {}
	send() {
		queueMicrotask(() => {
			if (scenario.progress != null)
				this.upload.onprogress?.({ lengthComputable: true, loaded: scenario.progress, total: 100 });
			if (scenario.networkError) {
				this.onerror?.();
				return;
			}
			this.status = scenario.status;
			this.responseText = scenario.responseText ?? '';
			this.onload?.();
		});
	}
}

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	scenario = { status: 200, responseText: '{}' };
	vi.stubGlobal('XMLHttpRequest', FakeXHR as any);
});

afterEach(() => {
	vi.stubGlobal('XMLHttpRequest', realXHR);
	vi.useRealTimers();
});

describe('upload store', () => {
	it('createDraft stores id/slug and sets status to draft', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ id: 'a1', slug: 'my-lora' }));
		const store = useUploadStore();
		const id = await store.createDraft({ name: 'X' });
		expect(id).toBe('a1');
		expect(store.draftId).toBe('a1');
		expect(store.draftSlug).toBe('my-lora');
		expect(store.status).toBe('draft');
	});

	it('createDraft surfaces the server message on failure', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'nope' } }));
		const store = useUploadStore();
		await expect(store.createDraft({})).rejects.toBeTruthy();
		expect(store.error).toBe('nope');
	});

	it('uploadScreenshot requires a draft first', async () => {
		const store = useUploadStore();
		await expect(store.uploadScreenshot(new File(['x'], 'x.png'))).rejects.toThrow(/no draft/i);
	});

	it('reset clears all draft state', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ id: 'a1', slug: 's' }));
		const store = useUploadStore();
		await store.createDraft({});
		store.reset();
		expect(store.draftId).toBeNull();
		expect(store.status).toBeNull();
		expect(store.uploadProgress).toBe(0);
	});

	// helper: create a draft so asset uploads have an id to target
	async function withDraft() {
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ id: 'a1', slug: 's' }));
		const store = useUploadStore();
		await store.createDraft({});
		return store;
	}

	it('createDraft uses fallback message on a bare rejection', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		const store = useUploadStore();
		await expect(store.createDraft({})).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to create draft');
	});

	it('uploadConfig reports progress and marks config done', async () => {
		const store = await withDraft();
		scenario = {
			status: 200,
			responseText: JSON.stringify({ status: 'processing' }),
			progress: 50
		};
		const res = await store.uploadConfig(new File(['x'], 'adapter_config.json'));
		expect(store.configState).toBe('done');
		expect(store.uploadProgress).toBe(100);
		expect(store.status).toBe('processing');
		expect(res.status).toBe('processing');
	});

	it('uploadWeights marks weights done and tolerates empty response body', async () => {
		const store = await withDraft();
		scenario = { status: 204, responseText: '' };
		await store.uploadWeights(new File(['w'], 'weights.safetensors'));
		expect(store.weightsState).toBe('done');
	});

	it('uploadWeights tolerates unparseable success body', async () => {
		const store = await withDraft();
		scenario = { status: 200, responseText: 'not json' };
		await store.uploadWeights(new File(['w'], 'w.bin'));
		expect(store.weightsState).toBe('done');
	});

	it('uploadAsset surfaces the server message and sets error state on http failure', async () => {
		const store = await withDraft();
		scenario = { status: 413, responseText: JSON.stringify({ message: 'too big' }) };
		await expect(store.uploadConfig(new File(['x'], 'c.json'))).rejects.toBeTruthy();
		expect(store.configState).toBe('error');
		expect(store.error).toBe('too big');
	});

	it('uploadAsset falls back to a status message when the error body is not json', async () => {
		const store = await withDraft();
		scenario = { status: 500, responseText: '<html>' };
		await expect(store.uploadWeights(new File(['w'], 'w.bin'))).rejects.toBeTruthy();
		expect(store.error).toMatch(/Upload failed \(500\)/);
	});

	it('uploadAsset surfaces a network error', async () => {
		const store = await withDraft();
		scenario = { status: 0, networkError: true };
		await expect(store.uploadConfig(new File(['x'], 'c.json'))).rejects.toBeTruthy();
		expect(store.error).toBe('Network error during upload');
	});

	it('uploadAsset requires a draft first', async () => {
		const store = useUploadStore();
		await expect(store.uploadConfig(new File(['x'], 'c.json'))).rejects.toThrow(/no draft/i);
	});

	it('uploadScreenshot posts to the screenshots endpoint', async () => {
		const store = await withDraft();
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ pathname: '/s/1.png', screenshots: ['/s/1.png'] })
		);
		const res = await store.uploadScreenshot(new File(['x'], 's.png'));
		expect(res.screenshots).toEqual(['/s/1.png']);
	});

	it('uploadScreenshot surfaces the error message', async () => {
		const store = await withDraft();
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { message: 'bad shot' } }));
		await expect(store.uploadScreenshot(new File(['x'], 's.png'))).rejects.toBeTruthy();
		expect(store.error).toBe('bad shot');
	});

	it('startPublish requires a draft first', async () => {
		const store = useUploadStore();
		await expect(store.startPublish()).rejects.toThrow(/no draft/i);
	});

	it('startPublish sets status and begins polling until terminal', async () => {
		vi.useFakeTimers();
		const store = await withDraft();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, status: 'pushing' })
			.mockResolvedValueOnce({ status: 'pushing' })
			.mockResolvedValue({ status: 'published', statusMessage: 'done', job: { id: 'j' } });
		vi.stubGlobal('$fetch', fetchMock);
		const res = await store.startPublish();
		expect(res.status).toBe('pushing');
		expect(store.status).toBe('pushing');
		expect(store.polling).toBe(true);
		await vi.runAllTimersAsync();
		expect(store.status).toBe('published');
		expect(store.polling).toBe(false);
		expect(store.job).toEqual({ id: 'j' });
	});

	it('startPublish surfaces the error message', async () => {
		const store = await withDraft();
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ message: 'pub fail' }));
		await expect(store.startPublish()).rejects.toBeTruthy();
		expect(store.error).toBe('pub fail');
	});

	it('pollStatus returns early without a draft', async () => {
		const store = useUploadStore();
		await expect(store.pollStatus()).resolves.toBeUndefined();
	});

	it('pollStatus stops immediately on failed', async () => {
		const store = await withDraft();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ status: 'failed', statusMessage: 'nope' }));
		const res = await store.pollStatus();
		expect(res!.status).toBe('failed');
		expect(store.polling).toBe(false);
		expect(store.statusMessage).toBe('nope');
	});

	it('pollStatus reschedules while in progress', async () => {
		vi.useFakeTimers();
		const store = await withDraft();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ status: 'pushing' })
			.mockResolvedValue({ status: 'published' });
		vi.stubGlobal('$fetch', fetchMock);
		await store.pollStatus();
		expect(store.polling).toBe(true);
		await vi.runAllTimersAsync();
		expect(store.status).toBe('published');
	});

	it('pollStatus error path stops polling and surfaces the message', async () => {
		const store = await withDraft();
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({}));
		await expect(store.pollStatus()).rejects.toBeTruthy();
		expect(store.error).toBe('Failed to poll status');
		expect(store.polling).toBe(false);
	});

	it('publishPreflight fetches the preflight endpoint', async () => {
		vi.stubGlobal(
			'$fetch',
			vi.fn().mockResolvedValue({ canPublish: true, detail: 'ok', accountLabel: 'L' })
		);
		const store = useUploadStore();
		const res = await store.publishPreflight('a1');
		expect(res.canPublish).toBe(true);
	});

	it('stopPolling clears a scheduled poll timer', async () => {
		vi.useFakeTimers();
		const store = await withDraft();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ status: 'pushing' }));
		await store.pollStatus();
		expect(store.polling).toBe(true);
		store.stopPolling();
		expect(store.polling).toBe(false);
		await vi.runAllTimersAsync();
	});

	it('uploadWithProgress falls back to $fetch when XHR is unavailable', async () => {
		vi.stubGlobal('XMLHttpRequest', undefined as any);
		const store = await withDraft();
		vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ status: 'processing' }));
		await store.uploadConfig(new File(['x'], 'c.json'));
		expect(store.configState).toBe('done');
		expect(store.status).toBe('processing');
	});
});
