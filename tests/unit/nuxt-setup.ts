import { vi } from 'vitest';
import { defineComponent, h } from 'vue';

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
