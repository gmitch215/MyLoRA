import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import PushStatus from '~/components/adapter/PushStatus.vue';

describe('AdapterPushStatus', () => {
	it('shows the done state when published', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: null, status: 'published' as any }
		});
		expect(w.text()).toContain('Published and testable.');
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(false);
	});

	it('shows a spinner and phase label while pushing', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: { phase: 'weights' } as any, status: 'pushing' as any }
		});
		expect(w.findComponent({ name: 'AppSpinner' }).exists()).toBe(true);
		expect(w.text()).toContain('Uploading weights...');
	});

	it('falls back to Starting push when the job phase is unknown', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: {} as any, status: 'pushing' as any }
		});
		expect(w.text()).toContain('Starting push...');
	});

	it('renders the failure alert on error', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: null, status: 'failed' as any, statusMessage: 'boom' }
		});
		expect(w.text()).toContain('Publish Failed');
		expect(w.text()).toContain('boom');
	});

	it('emits retry from the retry button', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: { phase: 'error', error: 'nope' } as any, status: 'failed' as any }
		});
		const retry = w.findAllComponents({ name: 'UButton' }).find((b) => b.text().includes('Retry'));
		await retry!.trigger('click');
		expect(w.emitted('retry')).toBeTruthy();
	});

	it('shows the listed-not-pushed label in idle', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: null, status: 'listed' as any }
		});
		expect(w.text()).toContain('Listed; not yet pushed to Cloudflare.');
	});

	it('shows the waiting label for a draft with no job', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: null, status: 'draft' as any }
		});
		expect(w.text()).toContain('Waiting.');
	});

	it('derives the pushing view from the job when status is undecided', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: { phase: 'create' } as any, status: 'listed' as any }
		});
		expect(w.text()).toContain('Creating finetune...');
	});

	it('renders the compact layout', async () => {
		const w = await mountSuspended(PushStatus, {
			props: { job: { phase: 'config' } as any, status: 'pushing' as any, compact: true }
		});
		expect(w.text()).toContain('Uploading config...');
		expect(w.text()).not.toContain('Uploaded to storage (R2)');
	});

	it('shows the compact error message', async () => {
		const w = await mountSuspended(PushStatus, {
			props: {
				job: { phase: 'error', error: 'catalog rejected' } as any,
				status: 'failed' as any,
				compact: true
			}
		});
		expect(w.text()).toContain('catalog rejected');
	});
});
