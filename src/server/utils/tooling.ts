import type { Machine } from 'hub:db:schema';
import { mergeTooling } from '~/shared/defaults';
import { machineToolingSchema } from '~/shared/schemas';
import type { MachineTooling, ToolingSettings } from '~/shared/types';
import { getTooling } from './settings';

export function parseMachineTooling(raw: string | null | undefined): MachineTooling | null {
	if (!raw) return null;
	try {
		const parsed = machineToolingSchema.safeParse(JSON.parse(raw));
		return parsed.success && Object.keys(parsed.data).length ? parsed.data : null;
	} catch {
		return null;
	}
}

/** What a machine row stores: the overrides as json, or null when there are none. */
export function storeMachineTooling(value: MachineTooling | null | undefined): string | null {
	if (!value) return null;
	const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
	return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/** The settings with the machine's overrides on top; this is what a serve job runs with. */
export async function toolingFor(machine: Pick<Machine, 'tooling'>): Promise<ToolingSettings> {
	return mergeTooling(await getTooling(), parseMachineTooling(machine.tooling));
}
