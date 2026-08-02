import { VERSUS_HARD_MAX, VERSUS_HARD_MIN } from './schemas';

export type VersusSide = 'a' | 'b';

export type VersusTurn = { side: VersusSide; content: string };

export type VersusPreset = {
	id: string;
	label: string;
	description: string;
	personaA: string;
	personaB: string;
};

// stance pairs; an empty-persona run usually degenerates into both models agreeing by turn two
export const VERSUS_PRESETS: VersusPreset[] = [
	{
		id: 'debate',
		label: 'Debate',
		description: 'Two opposed positions argue the topic',
		personaA:
			'You are debating an opponent. Argue FOR the topic. Be direct and concrete, cite specifics, and rebut the strongest point your opponent just made. Keep each reply under 120 words. Never concede the whole position.',
		personaB:
			'You are debating an opponent. Argue AGAINST the topic. Be direct and concrete, cite specifics, and rebut the strongest point your opponent just made. Keep each reply under 120 words. Never concede the whole position.'
	},
	{
		id: 'interview',
		label: 'Interview',
		description: 'One side asks, the other answers',
		personaA:
			'You are an interviewer. Ask exactly one sharp, specific question at a time about the topic, building on the previous answer. Never answer your own question. Keep each turn under 60 words.',
		personaB:
			'You are the expert being interviewed about the topic. Answer the question you were just asked, concretely and with examples. Do not ask questions back. Keep each reply under 120 words.'
	},
	{
		id: 'collaborate',
		label: 'Collaborate',
		description: 'Both sides build one plan together',
		personaA:
			'You are collaborating with a peer on the topic. Propose concrete next steps and build directly on what your peer just said. Add something new every turn; do not restate agreement. Keep each reply under 120 words.',
		personaB:
			'You are collaborating with a peer on the topic. Pressure-test each proposal, then improve it with a specific alternative. Add something new every turn. Keep each reply under 120 words.'
	},
	{
		id: 'freeform',
		label: 'Freeform',
		description: 'No stance; write your own personas',
		personaA: '',
		personaB: ''
	}
];

export const DEFAULT_VERSUS_PRESET = 'debate';
export const DEFAULT_VERSUS_MESSAGES = 5;

export function versusPreset(id: string): VersusPreset | undefined {
	return VERSUS_PRESETS.find((p) => p.id === id);
}

export function clampVersusMessages(value: number, min: number, max: number): number {
	const lo = Math.min(
		Math.max(Math.trunc(min) || VERSUS_HARD_MIN, VERSUS_HARD_MIN),
		VERSUS_HARD_MAX
	);
	const hi = Math.min(Math.max(Math.trunc(max) || VERSUS_HARD_MIN, lo), VERSUS_HARD_MAX);
	const n = Math.trunc(value);
	if (!Number.isFinite(n)) return lo;
	return Math.min(Math.max(n, lo), hi);
}

/**
 * The message array one side sends for its next turn.
 *
 * Each agent sees the run from its own point of view: its own prior messages are `assistant`,
 * the opponent's are `user`. The result always STARTS on `user`, alternates, and ends on `user` -
 * chat templates reject anything else with "Conversation roles must alternate
 * user/assistant/user/assistant/...". The first speaker's own opening reply would otherwise lead
 * with `assistant`, so the topic is re-inserted as its opening user turn.
 */
export function versusHistory(
	topic: string,
	transcript: VersusTurn[],
	side: VersusSide
): { role: 'user' | 'assistant'; content: string }[] {
	const mapped = (transcript ?? [])
		.filter((t) => t.content?.trim())
		.map((t) => ({
			role: (t.side === side ? 'assistant' : 'user') as 'user' | 'assistant',
			content: t.content
		}));

	const opening = { role: 'user' as const, content: topic };
	if (!mapped.length) return [opening];
	if (mapped[0]!.role === 'user') return mapped;
	if (topic?.trim()) return [opening, ...mapped];
	// no topic to open with; drop leading own-turns so the array still starts on `user`
	const firstUser = mapped.findIndex((m) => m.role === 'user');
	return firstUser > 0 ? mapped.slice(firstUser) : mapped;
}

/**
 * The system message for one side: its persona plus the shared topic.
 *
 * Returns '' when `maxChars` is 0, which is how the settings layer disables system prompts
 * app-wide; the caller must then omit the field entirely.
 */
export function versusSystem(persona: string, topic: string, maxChars: number): string {
	if (!(maxChars > 0)) return '';
	const parts = [persona?.trim(), topic?.trim() ? `Topic: ${topic.trim()}` : ''].filter(Boolean);
	return parts.join('\n\n').slice(0, maxChars);
}

// the side that speaks message `index` (0-based) of a run started by `first`
export function versusSideAt(first: VersusSide, index: number): VersusSide {
	const other: VersusSide = first === 'a' ? 'b' : 'a';
	return index % 2 === 0 ? first : other;
}
