import { describe, expect, it } from 'vitest';
import {
	ADMIN_CAPABILITY,
	capabilityFor,
	clampPublicLimit,
	DEFAULT_LIMITS,
	DEFAULT_PERMISSIONS,
	PUBLIC_LIMIT_RANGES
} from '../../../src/shared/defaults';
import { VERSUS_HARD_MAX, VERSUS_HARD_MIN } from '../../../src/shared/schemas';
import { DEFAULT_VERSUS_MESSAGES } from '../../../src/shared/versus';

describe('capabilityFor', () => {
	it('always returns the full admin capability for administrator (ignores the matrix)', () => {
		expect(capabilityFor('administrator', DEFAULT_PERMISSIONS)).toBe(ADMIN_CAPABILITY);
	});

	it('looks up developer from the permission matrix', () => {
		expect(capabilityFor('developer', DEFAULT_PERMISSIONS)).toBe(DEFAULT_PERMISSIONS.developer);
	});

	it('looks up manager from the permission matrix', () => {
		expect(capabilityFor('manager', DEFAULT_PERMISSIONS)).toBe(DEFAULT_PERMISSIONS.manager);
	});
});

describe('clampPublicLimit', () => {
	it('clamps promptsPerHour below/within/above its range', () => {
		const { min, max } = PUBLIC_LIMIT_RANGES.promptsPerHour;
		expect(clampPublicLimit('promptsPerHour', min - 5)).toBe(min);
		expect(clampPublicLimit('promptsPerHour', min + 1)).toBe(min + 1);
		expect(clampPublicLimit('promptsPerHour', max + 100)).toBe(max);
	});

	it('clamps outputTokensPerHour below/within/above its range', () => {
		const { min, max } = PUBLIC_LIMIT_RANGES.outputTokensPerHour;
		expect(clampPublicLimit('outputTokensPerHour', 0)).toBe(min);
		expect(clampPublicLimit('outputTokensPerHour', (min + max) / 2)).toBe((min + max) / 2);
		expect(clampPublicLimit('outputTokensPerHour', max + 5000)).toBe(max);
	});

	it('returns the exact bound when the value equals it', () => {
		const { min, max } = PUBLIC_LIMIT_RANGES.promptsPerHour;
		expect(clampPublicLimit('promptsPerHour', min)).toBe(min);
		expect(clampPublicLimit('promptsPerHour', max)).toBe(max);
	});
});

describe('DEFAULT_LIMITS versus range', () => {
	it('defaults the configurable range to 1-10 inside the hard bounds', () => {
		expect(DEFAULT_LIMITS.versusMinMessages).toBe(1);
		expect(DEFAULT_LIMITS.versusMaxMessages).toBe(10);
		expect(DEFAULT_LIMITS.versusMinMessages).toBeGreaterThanOrEqual(VERSUS_HARD_MIN);
		expect(DEFAULT_LIMITS.versusMaxMessages).toBeLessThanOrEqual(VERSUS_HARD_MAX);
		expect(DEFAULT_LIMITS.versusMinMessages).toBeLessThanOrEqual(DEFAULT_LIMITS.versusMaxMessages);
	});

	it('brackets the per-run default of 5', () => {
		expect(DEFAULT_LIMITS.versusMinMessages).toBeLessThanOrEqual(DEFAULT_VERSUS_MESSAGES);
		expect(DEFAULT_LIMITS.versusMaxMessages).toBeGreaterThanOrEqual(DEFAULT_VERSUS_MESSAGES);
	});
});
