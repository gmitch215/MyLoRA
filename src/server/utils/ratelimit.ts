import type { H3Event } from 'h3';
import type { SessionUser } from './auth';
import { clientIp, ipHash } from './ua';

function hourBucket(): number {
	return Math.floor(Date.now() / 3_600_000);
}

function secondsUntilNextHour(): number {
	return 3600 - Math.floor((Date.now() % 3_600_000) / 1000);
}

async function readCount(k: string): Promise<number> {
	try {
		return (await kv.get<number>(k)) ?? 0;
	} catch {
		return 0;
	}
}

async function bump(k: string, by: number, ttl: number): Promise<number> {
	const next = (await readCount(k)) + by;
	try {
		await kv.set(k, next, { ttl });
	} catch {
		// never block a request on a counter write
	}
	return next;
}

// fixed-window counter; throws 429 when the ceiling is reached
export async function enforceLimit(
	event: H3Event,
	opts: { cls: string; subject: string; limit: number; windowSeconds: number }
): Promise<void> {
	if (opts.limit <= 0) return;
	const bucket = Math.floor(Date.now() / (opts.windowSeconds * 1000));
	const k = `mylora:rl:${opts.cls}:${opts.subject}:${bucket}`;
	const current = await readCount(k);
	if (current >= opts.limit) {
		const reset =
			opts.windowSeconds - Math.floor((Date.now() % (opts.windowSeconds * 1000)) / 1000);
		setResponseHeader(event, 'Retry-After', reset);
		throw createError({ statusCode: 429, statusMessage: 'Too many requests' });
	}
	await bump(k, 1, opts.windowSeconds);
}

// resolve the rate subject: hashed ip for anon, user id for authed
export async function rateSubject(event: H3Event, user: SessionUser | null): Promise<string> {
	if (user) return `u:${user.id}`;
	const salt = useRuntimeConfig().analyticsSalt;
	return `ip:${await ipHash(clientIp(event), salt)}`;
}

export type InferenceGate = {
	tier: 'public' | 'developer';
	subject: string;
	promptKey: string;
	tokenKey: string;
};

// check the dual per-hour budget before running inference; both caps enforced (0 = unlimited)
export async function enforceInferenceBudget(
	event: H3Event,
	tier: RateTier,
	tierName: 'public' | 'developer',
	user: SessionUser | null
): Promise<InferenceGate> {
	const subject = await rateSubject(event, user);
	const bucket = hourBucket();
	const promptKey = `mylora:rl:infer:p:${tierName}:${subject}:${bucket}`;
	const tokenKey = `mylora:rl:infer:t:${tierName}:${subject}:${bucket}`;

	const [prompts, tokens] = await Promise.all([readCount(promptKey), readCount(tokenKey)]);
	const overPrompts = tier.promptsPerHour > 0 && prompts >= tier.promptsPerHour;
	const overTokens = tier.outputTokensPerHour > 0 && tokens >= tier.outputTokensPerHour;

	if (overPrompts || overTokens) {
		const reset = secondsUntilNextHour();
		setResponseHeader(event, 'Retry-After', reset);
		const reason =
			tier.precedence === 'tokens' && overTokens
				? 'Hourly output-token limit reached'
				: overPrompts
					? 'Hourly prompt limit reached'
					: 'Hourly output-token limit reached';
		throw createError({ statusCode: 429, statusMessage: reason });
	}

	// check-only; callers record the prompt after a successful response so failures are not charged
	return { tier: tierName, subject, promptKey, tokenKey };
}

export async function recordPrompt(gate: InferenceGate): Promise<void> {
	await bump(gate.promptKey, 1, secondsUntilNextHour());
}

export async function recordOutputTokens(gate: InferenceGate, outputTokens: number): Promise<void> {
	if (outputTokens > 0) await bump(gate.tokenKey, outputTokens, secondsUntilNextHour());
}

// coarse per-account guard; sheds load before hitting cloudflare's shared per-minute ceiling
export async function accountBudgetGuard(
	event: H3Event,
	accountId: string,
	perMinute: number
): Promise<void> {
	if (perMinute <= 0) return;
	const bucket = Math.floor(Date.now() / 60_000);
	const k = `mylora:rl:acct:${accountId}:${bucket}`;
	const current = await readCount(k);
	if (current >= perMinute) {
		setResponseHeader(event, 'Retry-After', 30);
		throw createError({ statusCode: 503, statusMessage: 'Account inference budget exhausted' });
	}
	await bump(k, 1, 60);
}
