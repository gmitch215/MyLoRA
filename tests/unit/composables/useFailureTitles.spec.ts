import { describe, expect, it } from 'vitest';
import { failureTitle, useFailureTitles } from '~/composables/useFailureTitles';

describe('useFailureTitles', () => {
	it('maps each known failure class to its title', () => {
		expect(failureTitle('none')).toBe('Training Failed');
		expect(failureTitle('reported')).toBe('Training Reported a Failure');
		expect(failureTitle('abnormal')).toBe('Training Ended Abnormally');
		expect(failureTitle('preflight')).toBe('Preflight Check Failed');
		expect(failureTitle('verify')).toBe('Output Verification Failed');
		expect(failureTitle('sync')).toBe('Result Sync Failed');
		expect(failureTitle('aborted')).toBe('Training Aborted');
		expect(failureTitle('gated')).toBe('Model Access Denied');
	});

	it('falls back to the generic title for an unknown class', () => {
		expect(failureTitle('bogus' as any)).toBe('Training Failed');
	});

	it('exposes the full record with all classes', () => {
		const titles = useFailureTitles();
		expect(Object.keys(titles)).toEqual(
			expect.arrayContaining([
				'none',
				'reported',
				'abnormal',
				'preflight',
				'verify',
				'sync',
				'aborted',
				'gated'
			])
		);
		expect(titles.gated).toBe('Model Access Denied');
	});
});
