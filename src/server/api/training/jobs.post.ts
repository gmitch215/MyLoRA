import { blob } from 'hub:blob';
import { db } from 'hub:db';
import { trainingJobs } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canTrain');
	await ensureDatabase();

	const parsed = trainingJobCreateSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid training job')
		});
	}
	const data = parsed.data;

	// must be able to use the chosen machine (shared or owned + canTrain)
	const { machine } = await requireMachineAccess(event, data.machineId, 'use');

	// the auto-chain requires canPublish
	if ((data.autoPublish || data.autoUploadFinetune) && !(await hasCapability(user, 'canPublish'))) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Auto-Publish / Auto-Upload require the Publish capability'
		});
	}

	// resolve the CF lora family: doc2lora carries it from the curated base; peft derives from the
	// (free) HF base. only CF-deployable adapters can auto-upload to the finetune catalog.
	const cfModelType =
		data.engine === 'accelerate'
			? null // diffusion LoRA - never CF-deployable
			: data.engine === 'doc2lora'
				? (data.config.modelType ?? detectModelType(data.config.baseModel))
				: detectModelType(data.config.baseModel);
	if (data.autoUploadFinetune && !cfModelType) {
		throw createError({
			statusCode: 400,
			statusMessage: 'This base model is not Cloudflare-deployable; disable Auto-Upload to Finetune'
		});
	}

	// doc2lora needs its uploaded files; size them for the estimate (archive bytes inflated since they
	// extract larger). peft loads from HF (size unknown).
	let corpusBytes = 0;
	if (data.engine === 'doc2lora') {
		const listed = (await blob.list({ prefix: `datasets/${data.datasetId}/`, limit: 1000 })) as {
			blobs?: { pathname?: string; size?: number }[];
		};
		const files = (listed?.blobs ?? []).map((b) => ({ name: b.pathname ?? '', size: b.size ?? 0 }));
		if (!files.length) {
			const single = await blob.get(`datasets/${data.datasetId}`);
			if (!single)
				throw createError({ statusCode: 400, statusMessage: 'Dataset not found; upload it first' });
			corpusBytes = single.size ?? 0;
		} else {
			corpusBytes = estimatedCorpusBytes(files);
		}
	}

	const gpu: 'cpu' | 'mps' | 'cuda' = machine.gpuInfo
		? 'cuda'
		: data.config.device === 'cpu'
			? 'cpu'
			: 'cuda';
	// only estimate when we know the corpus size (doc2lora); peft eta is shown client-side instead
	const etaSeconds = corpusBytes
		? estimateTrainingSeconds({
				corpusBytes,
				baseModel: data.config.baseModel,
				gpu,
				epochs: data.config.epochs,
				load4bit: data.config.load4bit,
				// a machine that is not prepared yet pays the cold ML-stack download up front
				toolingReady: machine.toolingReady
			})
		: null;

	// snapshot the resolved model type into the config so the job record is self-describing
	const config = { ...data.config, modelType: cfModelType ?? undefined };

	// optional per-job HF token -> envelope-encrypted columns
	let hfCols: Record<string, unknown> = {};
	if (data.hfToken) {
		await assertEncryptionKey();
		const enc = await encryptSecret(data.hfToken);
		hfCols = {
			hfTokenCipher: enc.cipher,
			hfTokenIv: enc.iv,
			hfTokenDekCipher: enc.dekCipher,
			hfTokenDekIv: enc.dekIv
		};
	}

	const id = crypto.randomUUID().replace(/-/g, '');

	// ephemeral sudo creds: stashed transiently (encrypted, short TTL) for the async launch to read;
	// never written to the job record. the password falls back to the machine's ssh password server-side
	if (config.useSudo) {
		await stashSudoCreds(id, {
			user: data.sudoUser || undefined,
			password: data.sudoPassword || undefined
		});
	}

	await db.insert(trainingJobs).values({
		id,
		machineId: data.machineId,
		authorId: user.id,
		engine: data.engine,
		status: 'queued',
		datasetId: data.datasetId || null,
		inputKind: data.inputKind,
		config: JSON.stringify(config),
		autoPublish: data.autoPublish,
		autoUploadFinetune: data.autoUploadFinetune,
		accountId: data.accountId ?? null,
		etaSeconds,
		...hfCols
	});

	// start it without blocking the response; the cron/alarm + page polling continue it
	if (typeof (event as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil === 'function') {
		(event as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(
			advanceJob(id).then(() => kickJob(id))
		);
	} else {
		void advanceJob(id).then(() => kickJob(id));
	}

	return { id };
});
