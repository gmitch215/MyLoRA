import { blob } from 'hub:blob';
import {
	datasetSummary,
	isSupportedDatasetContentType,
	nameFromUrl,
	uniqueDatasetName
} from '~/server/utils/datasets';
import { isMockSsh } from '~/server/utils/remote';

// load a remote file into the dataset by URL. validates by CONTENT-TYPE via HEAD (falling back to a
// GET), not the browser file extension, then fetches the bytes server-side (no CORS) and stores them.
export default defineEventHandler(async (event) => {
	await requireCapability(event, 'canTrain');
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No dataset id provided' });
	const limits = await getLimits();

	const body = await readBody<{ url?: string; extras?: 'core' | 'docs' | 'all' }>(event);
	const url = (body?.url || '').trim();
	// the doc2lora install scope gates which content types are accepted (text always; docs adds
	// pdf/office/html/...; all adds media). defaults to docs when the caller does not say
	const scope = body?.extras === 'core' || body?.extras === 'all' ? body.extras : 'docs';
	if (!/^https?:\/\//i.test(url)) {
		throw createError({ statusCode: 400, statusMessage: 'Provide an http(s) URL' });
	}

	if (isMockSsh()) {
		// deterministic for e2e: store a small synthetic file named from the url
		const name = await uniqueDatasetName(id, nameFromUrl(url));
		await blob.put(
			`datasets/${id}/${name}`,
			new TextEncoder().encode(`mock content for ${url}\n`),
			{
				contentType: 'text/plain'
			}
		);
		return { datasetId: id, added: name, ...(await datasetSummary(id)) };
	}

	// HEAD first to read content-type + size without downloading; some servers reject HEAD -> GET
	let contentType: string | null = null;
	let contentLength = 0;
	let disposition: string | null = null;
	try {
		const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
		if (head.ok) {
			contentType = head.headers.get('content-type');
			contentLength = Number(head.headers.get('content-length') || 0);
			disposition = head.headers.get('content-disposition');
		}
	} catch {
		// fall through to GET
	}

	if (contentType && !isSupportedDatasetContentType(contentType, scope)) {
		throw createError({
			statusCode: 415,
			statusMessage: `Unsupported content type: ${contentType.split(';')[0]}`
		});
	}
	if (contentLength && contentLength > limits.maxWeightsBytes) {
		throw createError({ statusCode: 413, statusMessage: 'Remote file exceeds the size limit' });
	}

	const res = await fetch(url, { redirect: 'follow' }).catch(() => null);
	if (!res || !res.ok) {
		throw createError({ statusCode: 400, statusMessage: 'Could not fetch the URL' });
	}
	const ct = contentType || res.headers.get('content-type');
	if (!isSupportedDatasetContentType(ct, scope)) {
		throw createError({
			statusCode: 415,
			statusMessage: `Unsupported content type: ${(ct || 'unknown').split(';')[0]}`
		});
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.length > limits.maxWeightsBytes) {
		throw createError({ statusCode: 413, statusMessage: 'Remote file exceeds the size limit' });
	}

	const name = await uniqueDatasetName(
		id,
		nameFromUrl(url, disposition || res.headers.get('content-disposition'))
	);
	await blob.put(`datasets/${id}/${name}`, bytes, {
		contentType: ct || 'application/octet-stream'
	});
	return { datasetId: id, added: name, ...(await datasetSummary(id)) };
});
