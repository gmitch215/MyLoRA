import { beforeEach, describe, expect, it, vi } from 'vitest';

// datasets.ts does `import { blob } from 'hub:blob'` at module load; node cannot resolve it, so mock it
const blobList = vi.fn();
vi.mock('hub:blob', () => ({ blob: { list: (...a: unknown[]) => blobList(...a) } }));

let mod: typeof import('../../../src/server/utils/datasets');

beforeEach(async () => {
	blobList.mockReset();
	mod = await import('../../../src/server/utils/datasets');
});

describe('sanitizeDatasetName', () => {
	it('strips the directory and unsafe chars', () => {
		expect(mod.sanitizeDatasetName('foo/bar/baz.txt')).toBe('baz.txt');
		expect(mod.sanitizeDatasetName('a b*c?.json')).toBe('a_b_c_.json');
	});

	it('defaults empty/nullish to file', () => {
		expect(mod.sanitizeDatasetName('')).toBe('file');
		expect(mod.sanitizeDatasetName(undefined as any)).toBe('file');
		expect(mod.sanitizeDatasetName('///')).toBe('file');
	});

	it('caps the length at 128', () => {
		const out = mod.sanitizeDatasetName('a'.repeat(300));
		expect(out.length).toBe(128);
	});
});

describe('isSupportedDatasetContentType', () => {
	it('rejects empty/nullish', () => {
		expect(mod.isSupportedDatasetContentType(null)).toBe(false);
		expect(mod.isSupportedDatasetContentType('')).toBe(false);
		expect(mod.isSupportedDatasetContentType('   ')).toBe(false);
	});

	it('accepts text and code types in every scope', () => {
		for (const scope of ['core', 'docs', 'all'] as const) {
			expect(mod.isSupportedDatasetContentType('text/plain', scope)).toBe(true);
			expect(mod.isSupportedDatasetContentType('application/json', scope)).toBe(true);
			expect(mod.isSupportedDatasetContentType('text/x-python', scope)).toBe(true);
			expect(mod.isSupportedDatasetContentType('application/octet-stream', scope)).toBe(true);
		}
	});

	it('strips parameters and lowercases before matching', () => {
		expect(mod.isSupportedDatasetContentType('TEXT/Plain; charset=utf-8')).toBe(true);
	});

	it('core scope rejects docs (pdf, html, csv) but docs/all accept them', () => {
		expect(mod.isSupportedDatasetContentType('application/pdf', 'core')).toBe(false);
		expect(mod.isSupportedDatasetContentType('text/html', 'core')).toBe(false);
		expect(mod.isSupportedDatasetContentType('text/csv', 'core')).toBe(false);
		expect(mod.isSupportedDatasetContentType('application/pdf', 'docs')).toBe(true);
		expect(mod.isSupportedDatasetContentType('text/csv', 'all')).toBe(true);
		expect(mod.isSupportedDatasetContentType('application/zip', 'docs')).toBe(true);
	});

	it('media only allowed in the all scope', () => {
		expect(mod.isSupportedDatasetContentType('image/png', 'docs')).toBe(false);
		expect(mod.isSupportedDatasetContentType('image/png', 'all')).toBe(true);
		expect(mod.isSupportedDatasetContentType('video/mp4', 'all')).toBe(true);
	});

	it('rejects truly unknown types', () => {
		expect(mod.isSupportedDatasetContentType('application/x-weird', 'all')).toBe(false);
	});

	it('defaults to the docs scope', () => {
		expect(mod.isSupportedDatasetContentType('application/pdf')).toBe(true);
		expect(mod.isSupportedDatasetContentType('image/png')).toBe(false);
	});
});

describe('nameFromUrl', () => {
	it('prefers the content-disposition filename', () => {
		expect(mod.nameFromUrl('https://x/y', 'attachment; filename="data set.jsonl"')).toBe(
			'data_set.jsonl'
		);
	});

	it('handles the RFC 5987 filename* form and url-decodes', () => {
		expect(mod.nameFromUrl('https://x/y', "attachment; filename*=UTF-8''my%20file.csv")).toBe(
			'my_file.csv'
		);
	});

	it('falls back to the url path basename', () => {
		expect(mod.nameFromUrl('https://x/a/b/train.jsonl')).toBe('train.jsonl');
		expect(mod.nameFromUrl('https://x/a/b/train.jsonl?token=1')).toBe('train.jsonl');
	});

	it('returns download for an empty path or unparsable url', () => {
		expect(mod.nameFromUrl('https://x/')).toBe('download');
		expect(mod.nameFromUrl('not a url')).toBe('download');
	});
});

describe('listDatasetFiles / datasetSummary / uniqueDatasetName', () => {
	it('lists, maps basenames and sorts by name', async () => {
		blobList.mockResolvedValue({
			blobs: [
				{ pathname: 'datasets/id/z.txt', size: 3 },
				{ pathname: 'datasets/id/a.txt', size: 1 }
			]
		});
		const files = await mod.listDatasetFiles('id');
		expect(files).toEqual([
			{ name: 'a.txt', size: 1 },
			{ name: 'z.txt', size: 3 }
		]);
	});

	it('returns [] when blob.list throws', async () => {
		blobList.mockRejectedValue(new Error('boom'));
		expect(await mod.listDatasetFiles('id')).toEqual([]);
	});

	it('summary classifies a lone jsonl as a dataset', async () => {
		blobList.mockResolvedValue({ blobs: [{ pathname: 'datasets/id/data.jsonl', size: 10 }] });
		const s = await mod.datasetSummary('id');
		expect(s).toEqual({
			files: [{ name: 'data.jsonl', size: 10 }],
			size: 10,
			fileCount: 1,
			inputKind: 'dataset'
		});
	});

	it('summary classifies multiple files as documents', async () => {
		blobList.mockResolvedValue({
			blobs: [
				{ pathname: 'datasets/id/a.md', size: 2 },
				{ pathname: 'datasets/id/b.md', size: 4 }
			]
		});
		const s = await mod.datasetSummary('id');
		expect(s.inputKind).toBe('documents');
		expect(s.size).toBe(6);
		expect(s.fileCount).toBe(2);
	});

	it('uniqueDatasetName appends underscores on collision', async () => {
		blobList.mockResolvedValue({ blobs: [{ pathname: 'datasets/id/doc.txt', size: 1 }] });
		expect(await mod.uniqueDatasetName('id', 'doc.txt')).toBe('_doc.txt');
		expect(await mod.uniqueDatasetName('id', 'fresh.txt')).toBe('fresh.txt');
	});
});
