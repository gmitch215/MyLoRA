import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import StatusBadge from '~/components/training/job/StatusBadge.vue';

describe('training/job/StatusBadge', () => {
	it('spins for an in-flight status and shows the label', async () => {
		const w = await mountSuspended(StatusBadge, { props: { status: 'running' } });
		expect(w.text()).toContain('Running');
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(true);
	});

	it('shows a static icon for a terminal status', async () => {
		const w = await mountSuspended(StatusBadge, { props: { status: 'completed' } });
		expect(w.text()).toContain('Completed');
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(false);
	});

	it('maps every known status to a label', async () => {
		const cases: Record<string, string> = {
			queued: 'Queued',
			provisioning: 'Provisioning',
			launching: 'Launching',
			running: 'Running',
			syncing: 'Syncing',
			verifying: 'Verifying',
			publishing: 'Publishing',
			completed: 'Completed',
			failed: 'Failed',
			abnormal: 'Abnormal',
			aborted: 'Aborted'
		};
		for (const [status, label] of Object.entries(cases)) {
			const w = await mountSuspended(StatusBadge, { props: { status: status as any } });
			expect(w.text()).toContain(label);
		}
	});

	it('falls back to queued for an unknown status', async () => {
		const w = await mountSuspended(StatusBadge, { props: { status: 'weird' as any } });
		expect(w.text()).toContain('Queued');
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(false);
	});
});
