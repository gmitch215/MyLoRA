import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLING } from '../../../src/shared/defaults';

const getTooling = vi.fn();
vi.mock('../../../src/server/utils/settings', () => ({ getTooling }));

const { parseMachineTooling, storeMachineTooling, toolingFor } =
	await import('../../../src/server/utils/tooling');

beforeEach(() => {
	getTooling.mockReset();
	getTooling.mockResolvedValue(DEFAULT_TOOLING);
});

describe('parseMachineTooling', () => {
	it('reads stored overrides and treats nothing, garbage and empty as none', () => {
		expect(parseMachineTooling('{"vllmVersion":"0.30.0"}')).toEqual({ vllmVersion: '0.30.0' });
		expect(parseMachineTooling(null)).toBeNull();
		expect(parseMachineTooling('')).toBeNull();
		expect(parseMachineTooling('not json')).toBeNull();
		expect(parseMachineTooling('{}')).toBeNull();
	});

	it('drops a stored blob that no longer passes validation', () => {
		expect(parseMachineTooling('{"vllmVersion":"x; rm -rf /"}')).toBeNull();
	});
});

describe('storeMachineTooling', () => {
	it('stores the fields given and null when there are none', () => {
		expect(storeMachineTooling({ autoInstall: false })).toBe('{"autoInstall":false}');
		expect(storeMachineTooling({})).toBeNull();
		expect(storeMachineTooling(null)).toBeNull();
		expect(storeMachineTooling(undefined)).toBeNull();
	});

	it('round-trips through parse and keeps a false and a zero', () => {
		const value = { autoInstall: false, bandwidthLimitKbps: 0, downloadRetries: 2 };
		expect(parseMachineTooling(storeMachineTooling(value))).toEqual(value);
	});

	it('leaves out an undefined field', () => {
		expect(storeMachineTooling({ vllmVersion: undefined, downloadRetries: 3 })).toBe(
			'{"downloadRetries":3}'
		);
	});
});

describe('toolingFor', () => {
	it('is the settings when the machine has no overrides', async () => {
		getTooling.mockResolvedValue({ ...DEFAULT_TOOLING, vllmVersion: '0.30.0' });
		expect(await toolingFor({ tooling: null })).toEqual({
			...DEFAULT_TOOLING,
			vllmVersion: '0.30.0'
		});
	});

	it('lets a machine override win for the fields it sets only', async () => {
		getTooling.mockResolvedValue({ ...DEFAULT_TOOLING, vllmVersion: '0.30.0', downloadRetries: 4 });
		const t = await toolingFor({ tooling: '{"vllmVersion":"0.29.0","autoInstall":false}' });
		expect(t.vllmVersion).toBe('0.29.0');
		expect(t.autoInstall).toBe(false);
		expect(t.downloadRetries).toBe(4);
	});
});
