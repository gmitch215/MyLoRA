import { blob } from 'hub:blob';
import { outputWeightsName } from '~/server/utils/remote-commands';

// download a completed job's artifacts (config + weights). download-only runs (non-CF PEFT /
// accelerate diffusion LoRA) keep them under jobs/<id>/; a CF-deployable run's artifacts were promoted
// into the adapters catalog, so we fall back there. gated by job ownership + the matrix.
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	const asset = getRouterParam(event, 'asset');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No job id provided' });
	const { job } = await requireJobAccess(event, id);

	if (asset !== 'weights' && asset !== 'config')
		throw createError({ statusCode: 400, statusMessage: "asset must be 'config' or 'weights'" });

	const jobKey =
		asset === 'weights' ? `jobs/${id}/weights.safetensors` : `jobs/${id}/adapter_config.json`;
	let object = await blob.get(jobKey);
	// name the weights download per engine (diffusers -> pytorch_lora_weights.safetensors)
	let filename = asset === 'weights' ? outputWeightsName(job.engine) : 'adapter_config.json';
	if (!object && job.adapterId) {
		const adapterKey =
			asset === 'weights'
				? `adapters/${job.adapterId}/adapter_model.safetensors`
				: `adapters/${job.adapterId}/adapter_config.json`;
		object = await blob.get(adapterKey);
		if (asset === 'weights') filename = 'adapter_model.safetensors';
	}
	if (!object) throw createError({ statusCode: 404, statusMessage: 'Artifact not found' });
	setHeader(
		event,
		'content-type',
		asset === 'weights' ? 'application/octet-stream' : 'application/json'
	);
	setHeader(event, 'content-disposition', `attachment; filename="${filename}"`);
	return object;
});
