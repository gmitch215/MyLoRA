import { describe, expect, it } from 'vitest';
import { VERSUS_HARD_MAX, VERSUS_HARD_MIN } from '../../../src/shared/schemas';
import {
	clampVersusMessages,
	DEFAULT_VERSUS_MESSAGES,
	DEFAULT_VERSUS_PRESET,
	VERSUS_PRESETS,
	versusHistory,
	versusPreset,
	versusSideAt,
	versusSystem,
	type VersusSide,
	type VersusTurn
} from '../../../src/shared/versus';

const TOPIC = 'Tabs or spaces?';
const A1 = { side: 'a' as const, content: 'Tabs. Accessibility wins.' };
const B1 = { side: 'b' as const, content: 'Spaces. Consistent rendering.' };
const A2 = { side: 'a' as const, content: 'Rendering is a preference.' };

// (transcript, side) -> the exact role/content pairs that side should send
const HISTORY_CASES: {
	name: string;
	transcript: VersusTurn[];
	side: VersusSide;
	expected: { role: string; content: string }[];
}[] = [
	{
		name: 'first speaker, empty transcript -> the topic is the opening user turn',
		transcript: [],
		side: 'a',
		expected: [{ role: 'user', content: TOPIC }]
	},
	{
		name: 'second speaker, one message -> the opponent message is the user turn',
		transcript: [A1],
		side: 'b',
		expected: [{ role: 'user', content: A1.content }]
	},
	{
		name: 'first speaker, second turn -> the topic re-opens so it still starts on user',
		transcript: [A1, B1],
		side: 'a',
		expected: [
			{ role: 'user', content: TOPIC },
			{ role: 'assistant', content: A1.content },
			{ role: 'user', content: B1.content }
		]
	},
	{
		name: 'second speaker, second turn -> roles swap consistently',
		transcript: [A1, B1, A2],
		side: 'b',
		expected: [
			{ role: 'user', content: A1.content },
			{ role: 'assistant', content: B1.content },
			{ role: 'user', content: A2.content }
		]
	}
];

describe('versusHistory', () => {
	for (const c of HISTORY_CASES) {
		it(c.name, () => {
			expect(versusHistory(TOPIC, c.transcript, c.side)).toEqual(c.expected);
		});
	}

	it('always starts on user, alternates, and ends on user, for both first speakers', () => {
		for (const first of ['a', 'b'] as VersusSide[]) {
			const transcript: VersusTurn[] = [];
			for (let i = 0; i < 12; i++) {
				const side = versusSideAt(first, i);
				const history = versusHistory(TOPIC, transcript, side);
				// chat templates reject anything that does not begin on user
				expect(history[0]!.role, `first=${first} turn ${i} must start on user`).toBe('user');
				expect(history[history.length - 1]!.role, `first=${first} turn ${i} ends on user`).toBe(
					'user'
				);
				history.forEach((m, j) => {
					expect(m.role, `first=${first} turn ${i} alternates at ${j}`).toBe(
						j % 2 === 0 ? 'user' : 'assistant'
					);
				});
				transcript.push({ side, content: `message ${i}` });
			}
		}
	});

	it('re-opens with the topic when the first speaker would otherwise lead with assistant', () => {
		// regression: [assistant:A1, user:B1] alternates but starts on assistant, which workers AI
		// rejects with "Conversation roles must alternate user/assistant/..."
		expect(versusHistory(TOPIC, [A1, B1], 'a')).toEqual([
			{ role: 'user', content: TOPIC },
			{ role: 'assistant', content: A1.content },
			{ role: 'user', content: B1.content }
		]);
	});

	it('drops leading own-turns when there is no topic to re-open with', () => {
		expect(versusHistory('', [A1, B1], 'a')).toEqual([{ role: 'user', content: B1.content }]);
		expect(versusHistory('   ', [A1, B1], 'a')).toEqual([{ role: 'user', content: B1.content }]);
	});

	it('gives each side the opposite view of the same transcript', () => {
		const a = versusHistory(TOPIC, [A1, B1], 'a');
		const b = versusHistory(TOPIC, [A1, B1], 'b');
		expect(a.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
		expect(b.map((m) => m.role)).toEqual(['user', 'assistant']);
		// b ends mid-exchange (it is b's turn), a has been re-opened with the topic
		expect(a.map((m) => m.content)).toEqual([TOPIC, A1.content, B1.content]);
		expect(b.map((m) => m.content)).toEqual([A1.content, B1.content]);
	});

	it('drops blank messages rather than sending an empty turn', () => {
		expect(versusHistory(TOPIC, [A1, { side: 'b', content: '   ' }], 'b')).toEqual([
			{ role: 'user', content: A1.content }
		]);
	});

	it('falls back to the topic when every message is blank', () => {
		expect(versusHistory(TOPIC, [{ side: 'a', content: '' }], 'b')).toEqual([
			{ role: 'user', content: TOPIC }
		]);
	});

	it('tolerates a null transcript', () => {
		expect(versusHistory(TOPIC, null as never, 'a')).toEqual([{ role: 'user', content: TOPIC }]);
	});

	it('returns the own-turns unchanged when there is no user turn and no topic to open with', () => {
		// degenerate: nothing this side can answer, so there is nothing to slice to
		expect(versusHistory('', [A1], 'a')).toEqual([{ role: 'assistant', content: A1.content }]);
	});
});

describe('versusSideAt', () => {
	it('alternates from whichever side goes first', () => {
		expect([0, 1, 2, 3].map((i) => versusSideAt('a', i))).toEqual(['a', 'b', 'a', 'b']);
		expect([0, 1, 2, 3].map((i) => versusSideAt('b', i))).toEqual(['b', 'a', 'b', 'a']);
	});
});

describe('versusSystem', () => {
	it('joins the persona and the topic', () => {
		expect(versusSystem('Be terse.', TOPIC, 2000)).toBe(`Be terse.\n\nTopic: ${TOPIC}`);
	});

	it('emits the topic alone when the persona is blank', () => {
		expect(versusSystem('', TOPIC, 2000)).toBe(`Topic: ${TOPIC}`);
		expect(versusSystem('   ', TOPIC, 2000)).toBe(`Topic: ${TOPIC}`);
	});

	it('emits the persona alone when the topic is blank', () => {
		expect(versusSystem('Be terse.', '  ', 2000)).toBe('Be terse.');
	});

	it('returns empty when the system prompt limit disables the field', () => {
		expect(versusSystem('Be terse.', TOPIC, 0)).toBe('');
		expect(versusSystem('Be terse.', TOPIC, -5)).toBe('');
		expect(versusSystem('Be terse.', TOPIC, NaN)).toBe('');
	});

	it('truncates to the configured character limit', () => {
		const out = versusSystem('x'.repeat(500), TOPIC, 40);
		expect(out).toHaveLength(40);
		expect(out).toBe('x'.repeat(40));
	});

	it('returns empty when both persona and topic are blank', () => {
		expect(versusSystem('', '', 2000)).toBe('');
	});
});

describe('clampVersusMessages', () => {
	it('keeps a value inside the configured range', () => {
		expect(clampVersusMessages(5, 1, 10)).toBe(5);
	});

	it('clamps below the min and above the max', () => {
		expect(clampVersusMessages(0, 2, 10)).toBe(2);
		expect(clampVersusMessages(99, 1, 10)).toBe(10);
	});

	it('never escapes the hard bounds even when the range does', () => {
		expect(clampVersusMessages(999, 0, 999)).toBe(VERSUS_HARD_MAX);
		expect(clampVersusMessages(-4, -10, -1)).toBe(VERSUS_HARD_MIN);
	});

	it('treats an inverted range as min-wins', () => {
		expect(clampVersusMessages(3, 8, 2)).toBe(8);
	});

	it('falls back to the min for a non-numeric value', () => {
		expect(clampVersusMessages(NaN, 2, 10)).toBe(2);
	});

	it('truncates a fractional value', () => {
		expect(clampVersusMessages(4.9, 1, 10)).toBe(4);
	});

	it('treats a zero or NaN bound as the hard minimum', () => {
		// `Math.trunc(min) || VERSUS_HARD_MIN` - 0 and NaN both fall through to the floor
		expect(clampVersusMessages(5, 0, 10)).toBe(5);
		expect(clampVersusMessages(0, 0, 10)).toBe(VERSUS_HARD_MIN);
		expect(clampVersusMessages(5, NaN, NaN)).toBe(VERSUS_HARD_MIN);
	});
});

describe('VERSUS_PRESETS', () => {
	it('exposes the four stances with unique ids', () => {
		expect(VERSUS_PRESETS.map((p) => p.id)).toEqual([
			'debate',
			'interview',
			'collaborate',
			'freeform'
		]);
		expect(new Set(VERSUS_PRESETS.map((p) => p.id)).size).toBe(VERSUS_PRESETS.length);
	});

	it('gives every non-freeform preset two distinct, non-empty personas', () => {
		for (const preset of VERSUS_PRESETS.filter((p) => p.id !== 'freeform')) {
			expect(preset.personaA.trim(), preset.id).not.toBe('');
			expect(preset.personaB.trim(), preset.id).not.toBe('');
			expect(preset.personaA, preset.id).not.toBe(preset.personaB);
		}
	});

	it('leaves freeform personas blank so typed text survives', () => {
		const freeform = versusPreset('freeform')!;
		expect(freeform.personaA).toBe('');
		expect(freeform.personaB).toBe('');
	});

	it('labels and describes every preset in ascii', () => {
		for (const preset of VERSUS_PRESETS) {
			expect(preset.label).toBeTruthy();
			expect(preset.description).toBeTruthy();
			// the repo is ascii-only in code strings
			expect(/^[\x20-\x7e]*$/.test(preset.personaA + preset.personaB + preset.description)).toBe(
				true
			);
		}
	});

	it('resolves a preset by id and returns undefined for an unknown one', () => {
		expect(versusPreset(DEFAULT_VERSUS_PRESET)?.id).toBe('debate');
		expect(versusPreset('nope')).toBeUndefined();
	});

	it('defaults to a run length inside the default configurable range', () => {
		expect(DEFAULT_VERSUS_MESSAGES).toBe(5);
		expect(clampVersusMessages(DEFAULT_VERSUS_MESSAGES, 1, 10)).toBe(DEFAULT_VERSUS_MESSAGES);
	});
});
