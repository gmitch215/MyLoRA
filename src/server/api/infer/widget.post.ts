import { eq, sql } from 'drizzle-orm';
import { adapters, cloudflareAccounts } from '~/server/db/schema';

function buildMessages(body: any): ChatMessage[] {
	if (Array.isArray(body?.messages) && body.messages.length) {
		return body.messages
			.filter((m: any) => m && typeof m.content === 'string')
			.map((m: any) => ({
				role: m.role === 'system' || m.role === 'assistant' ? m.role : 'user',
				content: String(m.content)
			}));
	}
	if (typeof body?.prompt === 'string' && body.prompt.trim()) {
		return [{ role: 'user', content: body.prompt }];
	}
	return [];
}

// resolve the cloudflare account id used for the per-account budget guard
async function resolveCfAccountId(adapterAccountId: string | null): Promise<string> {
	if (adapterAccountId) {
		const r = (
			await db
				.select({ accountId: cloudflareAccounts.accountId })
				.from(cloudflareAccounts)
				.where(eq(cloudflareAccounts.id, adapterAccountId))
				.limit(1)
		)[0];
		if (r?.accountId) return r.accountId;
	}
	const def = (
		await db
			.select({ accountId: cloudflareAccounts.accountId })
			.from(cloudflareAccounts)
			.where(eq(cloudflareAccounts.isDefault, true))
			.limit(1)
	)[0];
	return def?.accountId || useRuntimeConfig().cf?.accountId || 'default';
}

export default defineEventHandler(async (event) => {
	await ensureDatabase();

	const access = await getAccess();
	const user = await getCurrentUser(event);
	if (access.testerAccess === 'login' && !user) {
		throw createError({ statusCode: 401, statusMessage: 'Login required to test adapters' });
	}

	const body = await readBody(event);
	const adapterId = body?.adapterId;
	if (!adapterId || typeof adapterId !== 'string') {
		throw createError({ statusCode: 400, statusMessage: 'adapterId is required' });
	}
	const messages = buildMessages(body);
	if (!messages.length) {
		throw createError({ statusCode: 400, statusMessage: 'A prompt or messages are required' });
	}

	const rows = await db.select().from(adapters).where(eq(adapters.id, adapterId)).limit(1);
	const row = rows[0];
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	if (!isTestable(row.status)) {
		throw createError({ statusCode: 409, statusMessage: 'Adapter is not available for testing' });
	}

	// budget: unlimitedTester bypass, else developer (authed) vs public (anon)
	const skipBudget = !!user && (await hasCapability(user, 'unlimitedTester'));
	const rateLimits = await getRateLimits();
	const limits = await getLimits();

	// optional system prompt, clamped to the configured ceiling, prepended to the turn
	const system =
		typeof body?.system === 'string'
			? body.system.trim().slice(0, limits.maxSystemPromptChars)
			: '';
	const finalMessages: ChatMessage[] =
		system && limits.maxSystemPromptChars > 0
			? [{ role: 'system', content: system }, ...messages]
			: messages;

	let gate: Awaited<ReturnType<typeof enforceInferenceBudget>> | null = null;
	if (!skipBudget) {
		const tierName = user ? 'developer' : 'public';
		gate = await enforceInferenceBudget(event, rateLimits[tierName], tierName, user);
	}

	const cfAccountId = await resolveCfAccountId(row.accountId);
	await accountBudgetGuard(event, cfAccountId, limits.accountBudgetPerMinute);

	// charge the prompt up front (the budget was already verified above)
	if (gate) await recordPrompt(gate);

	const adapter = toAdapter(row);
	const upstream = await runInferenceStream(event, adapterTarget(adapter), finalMessages, {
		maxTokens: limits.maxOutputTokens
	});

	// pass the sse stream through to the client while accumulating the text so we can charge output
	// tokens against the budget and bump the inference count once the response finishes
	const decoder = new TextDecoder();
	let buffer = '';
	let full = '';
	const accounting = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			controller.enqueue(chunk);
			buffer += decoder.decode(chunk, { stream: true });
			const frames = buffer.split('\n\n');
			buffer = frames.pop() ?? '';
			for (const frame of frames) {
				const line = frame
					.split('\n')
					.map((l) => l.trim())
					.find((l) => l.startsWith('data:'));
				if (!line) continue;
				const payload = line.slice('data:'.length).trim();
				if (!payload || payload === '[DONE]') continue;
				try {
					const json = JSON.parse(payload);
					full += json.response ?? json.delta ?? json.token ?? json.text ?? '';
				} catch {
					// ignore non-json frames
				}
			}
		},
		flush() {
			const finish = (async () => {
				if (gate) await recordOutputTokens(gate, estimateTokens(full));
				await db
					.update(adapters)
					.set({ inferenceCount: sql`${adapters.inferenceCount} + 1` })
					.where(eq(adapters.id, adapterId));
				// analytics: log the inference by model + audience (developer when logged in, else public)
				await recordInference(todayUTC(), {
					model: adapter.baseModel,
					audience: user ? 'developer' : 'public'
				});
			})();
			if (typeof (event as any).waitUntil === 'function') (event as any).waitUntil(finish);
			else void finish;
		}
	});

	setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8');
	setHeader(event, 'Cache-Control', 'no-cache');
	setHeader(event, 'Connection', 'keep-alive');
	return upstream.pipeThrough(accounting);
});
