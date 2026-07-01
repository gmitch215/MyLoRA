import { blob } from 'hub:blob';

export function sanitizeDatasetName(name: string): string {
	const base = (name || 'file').split('/').pop() || 'file';
	return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'file';
}

export type DatasetFile = { name: string; size: number };

export async function listDatasetFiles(id: string): Promise<DatasetFile[]> {
	try {
		const listed = (await blob.list({ prefix: `datasets/${id}/`, limit: 1000 })) as {
			blobs?: { pathname: string; size?: number }[];
		};
		return (listed?.blobs ?? [])
			.map((b) => ({ name: b.pathname.split('/').pop() || 'file', size: b.size ?? 0 }))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

export async function datasetSummary(id: string) {
	const files = await listDatasetFiles(id);
	const size = files.reduce((a, f) => a + f.size, 0);
	// a lone tabular/jsonl file reads as a dataset; anything else (incl. archives) is documents
	const inputKind: 'documents' | 'dataset' =
		files.length === 1 && /\.(jsonl|json|csv|tsv)$/i.test(files[0]!.name) ? 'dataset' : 'documents';
	return { files, size, fileCount: files.length, inputKind };
}

// ensure a unique name within the dataset (append underscores on collision)
export async function uniqueDatasetName(id: string, name: string): Promise<string> {
	const existing = new Set((await listDatasetFiles(id)).map((f) => f.name));
	let n = sanitizeDatasetName(name);
	while (existing.has(n)) n = `_${n}`;
	return n;
}

export type Doc2LoraScope = 'core' | 'docs' | 'all';

const TEXT_CT: RegExp[] = [
	// any text/* EXCEPT html/csv (those need the docs parsers); covers text/x-python, text/javascript
	/^text\/(?!html\b|csv\b)/,
	/^application\/json/,
	/^application\/(x-)?yaml/,
	/^application\/xml/,
	/^application\/(x-)?(javascript|typescript|ecmascript)/,
	/^application\/(x-)?(sh|shellscript|python|perl|ruby|php|httpd-php)/,
	/^application\/toml/,
	// unknown binary: doc2lora makes the real call by extension on the box, so allow it through
	/^application\/octet-stream/
];
const DOCS_CT: RegExp[] = [
	/^application\/pdf/,
	/^application\/vnd\.openxmlformats-officedocument\./,
	/^application\/vnd\.oasis\.opendocument\./,
	/^application\/msword/,
	/^application\/vnd\.ms-/,
	/^application\/rtf/,
	/^text\/rtf/,
	/^application\/epub\+zip/,
	/^text\/html/,
	/^application\/xhtml/,
	/^text\/csv/,
	/^application\/(x-)?ipynb/,
	// archive containers (extracted, then their documents parsed)
	/^application\/zip/,
	/^application\/x-tar/,
	/^application\/gzip/,
	/^application\/x-7z-compressed/,
	/^application\/x-bzip2/,
	/^application\/x-xz/
];
const MEDIA_CT: RegExp[] = [/^image\//, /^audio\//, /^video\//];

export function isSupportedDatasetContentType(
	contentType: string | null | undefined,
	scope: Doc2LoraScope = 'docs'
): boolean {
	const c = (contentType || '').split(';')[0]!.trim().toLowerCase();
	if (!c) return false;
	if (TEXT_CT.some((r) => r.test(c))) return true;
	if (scope !== 'core' && DOCS_CT.some((r) => r.test(c))) return true;
	if (scope === 'all' && MEDIA_CT.some((r) => r.test(c))) return true;
	return false;
}

// derive a filename from a url path or a content-disposition header
export function nameFromUrl(url: string, contentDisposition?: string | null): string {
	const cd = contentDisposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
	if (cd) return sanitizeDatasetName(decodeURIComponent(cd));
	try {
		const p = new URL(url).pathname;
		const last = p.split('/').filter(Boolean).pop();
		if (last) return sanitizeDatasetName(last);
	} catch {
		// fall through
	}
	return 'download';
}
