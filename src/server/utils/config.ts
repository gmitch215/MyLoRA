import type { H3Event } from 'h3';

// useRuntimeConfig() with no event is frozen when the isolate starts, before a deployed worker's
// variables are readable; with an event it re-reads the environment on the spot
export function runtimeConfig() {
	return useRuntimeConfig({ context: { nitro: {} } } as unknown as H3Event);
}
