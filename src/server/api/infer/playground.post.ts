import { eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters } from 'hub:db:schema';

function buildMessages(body: any): ChatMessage[] {
	if (!Array.isArray(body?.messages)) return [];
	return body.messages
		.filter((m: any) => m && typeof m.content === 'string')
		.map((m: any) => ({
			role: m.role === 'system' || m.role === 'assistant' ? m.role : 'user',
			content: String(m.content)
		}));
}

const ALLOWED_BASE_MODELS = new Set(DEFAULT_BASE_MODELS.map((m) => m.model));

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const user = await requireAuthed(event);

	const body = await readBody(event);
	const messages = buildMessages(body);
	if (!messages.length) {
		throw createError({ statusCode: 400, statusMessage: 'messages are required' });
	}

	// target is either a published adapter (base + lora) or a bare base model (no lora)
	let target: InferTarget;
	const adapterId = typeof body?.adapterId === 'string' ? body.adapterId : '';
	if (adapterId) {
		const rows = await db.select().from(adapters).where(eq(adapters.id, adapterId)).limit(1);
		const row = rows[0];
		if (!row) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
		if (!isTestable(row.status)) {
			throw createError({ statusCode: 409, statusMessage: 'Adapter is not available for testing' });
		}
		target = adapterTarget(toAdapter(row));
		await db
			.update(adapters)
			.set({ inferenceCount: sql`${adapters.inferenceCount} + 1` })
			.where(eq(adapters.id, adapterId));
	} else if (typeof body?.baseModel === 'string' && body.baseModel) {
		if (!ALLOWED_BASE_MODELS.has(body.baseModel)) {
			throw createError({ statusCode: 400, statusMessage: 'Unknown base model' });
		}
		// base-only run on the deployment account (no lora attached)
		target = { baseModel: body.baseModel };
	} else {
		throw createError({ statusCode: 400, statusMessage: 'adapterId or baseModel is required' });
	}

	// unlimitedTester bypasses; otherwise the developer-tier budget applies
	const skipBudget = await hasCapability(user, 'unlimitedTester');
	if (!skipBudget) {
		const rateLimits = await getRateLimits();
		const gate = await enforceInferenceBudget(event, rateLimits.developer, 'developer', user);
		await recordPrompt(gate);
	}

	// cap the response length; clamp the requested value to the configured ceiling
	const limits = await getLimits();
	const requested = Number(body?.maxTokens);
	const maxTokens =
		Number.isFinite(requested) && requested > 0
			? Math.min(Math.floor(requested), limits.maxOutputTokens)
			: limits.maxOutputTokens;

	const system =
		typeof body?.system === 'string'
			? body.system.trim().slice(0, limits.maxSystemPromptChars)
			: '';
	const finalMessages: ChatMessage[] =
		system && limits.maxSystemPromptChars > 0
			? [{ role: 'system', content: system }, ...messages]
			: messages;

	const stream = await runInferenceStream(event, target, finalMessages, { maxTokens });
	const record = recordInference(todayUTC(), { model: target.baseModel, audience: 'developer' });

	if (typeof (event as any).waitUntil === 'function') (event as any).waitUntil(record);
	else void record;

	setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8');
	setHeader(event, 'Cache-Control', 'no-cache');
	setHeader(event, 'Connection', 'keep-alive');
	return stream;
});
