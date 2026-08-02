import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

// nuxt 4.5 moved `$fetch` from a plain global to an auto-import out of `#build/fetch.mjs`, whose
// `export const $fetch = globalThis.$fetch` snapshots the instance at module-eval time. app code
// therefore holds the real ofetch instance and a per-test `vi.stubGlobal('$fetch')` stops reaching
// it (specs started firing real requests on the 4.5 bump). forward every call and property to
// whatever `globalThis.$fetch` is at call time so stubbing works as it did on 4.4.
vi.mock('#build/fetch.mjs', async (importOriginal) => {
	// the original module is what installs the configured instance on globalThis
	await importOriginal();
	const live = () =>
		globalThis.$fetch as unknown as ((...args: unknown[]) => unknown) &
			Record<string | symbol, unknown>;
	return {
		$fetch: new Proxy(function () {} as never, {
			apply: (_target, _thisArg, args: unknown[]) => live()(...args),
			get: (_target, property) => live()?.[property],
			// vitest's isMockFunction does `'_isMockFunction' in fn`, which would otherwise
			// fall through to the bare target and report the stub as "not a spy"
			has: (_target, property) => property in (live() ?? {}),
			getOwnPropertyDescriptor: (_target, property) => {
				const descriptor = Object.getOwnPropertyDescriptor(live() ?? {}, property);
				return descriptor && { ...descriptor, configurable: true };
			},
			ownKeys: () => Reflect.ownKeys(live() ?? {})
		})
	};
});

// @unovis/vue's charting engine schedules a setImmediate that throws `_idleNext` after happy-dom
// teardown; stub the Vis* components with a slot-passthrough so no engine (and no timer) runs
const Stub = defineComponent({
	name: 'VisStub',
	setup:
		(_props, { slots }) =>
		() =>
			h('div', slots.default?.())
});

vi.mock('@unovis/vue', () => ({
	VisXYContainer: Stub,
	VisLine: Stub,
	VisArea: Stub,
	VisAxis: Stub,
	VisTooltip: Stub,
	VisCrosshair: Stub
}));
