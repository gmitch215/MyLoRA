import { describe, expect, it } from 'vitest';
import {
	ADMIN_CAPABILITY,
	capabilityFor,
	clampPublicLimit,
	DEFAULT_PERMISSIONS,
	PUBLIC_LIMIT_RANGES
} from '../../../src/shared/defaults';

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
