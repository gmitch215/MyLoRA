import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Card from '~/components/training/job/Card.vue';

function cfg(overrides: Record<string, any> = {}) {
	return {
		baseModel: 'meta-llama/Llama-3.2-1B',
		rank: 8,
		loraAlpha: 16,
		loraDropout: 0.1,
		epochs: 3,
		learningRate: 0.0005,
		maxLength: 512,
		batchSize: 4,
		gradientAccumulationSteps: 1,
		load4bit: false,
		device: 'auto',
		targetModules: [],
		abortOnError: true,
		...overrides
	};
}

function job(overrides: Record<string, any> = {}): any {
	return {
		id: 'j1',
		engine: 'doc2lora',
		status: 'running',
		failureClass: 'none',
		inputKind: 'documents',
		config: cfg(),
		autoPublish: false,
		autoUploadFinetune: false,
		attempt: 1,
		consecutiveFailures: 0,
		downloadOnly: false,
		machineLabel: 'GPU Box',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
});

describe('training/job/Card', () => {
	it('renders title, engine label, base model and rank for a running job', async () => {
		const w = await mountSuspended(Card, { props: { job: job() } });
		expect(w.text()).toContain('GPU Box');
		expect(w.text()).toContain('doc2lora');
		// base model tail + rank
		expect(w.text()).toContain('Llama-3.2-1B');
		expect(w.text()).toContain('Rank 8');
		// running -> info border, abort visible, no delete
		expect(w.html()).toContain('border-info');
		expect(w.text()).toContain('Abort');
		expect(w.text()).not.toContain('Delete');
	});

	it('maps the PEFT engine label', async () => {
		const w = await mountSuspended(Card, { props: { job: job({ engine: 'peft' }) } });
		expect(w.text()).toContain('PEFT');
	});

	it('shows the failure alert and auto-expands logs for a failed job', async () => {
		const w = await mountSuspended(Card, {
			props: {
				job: job({
					status: 'failed',
					failureClass: 'preflight',
					statusMessage: 'boom',
					logTail: 'trace line'
				})
			}
		});
		expect(w.html()).toContain('border-error');
		// failed -> expanded log tail component present
		expect(w.findComponent({ name: 'TrainingJobLogTail' }).exists()).toBe(true);
		// retry offered for a failed job
		expect(w.text()).toContain('Retry');
	});

	it('offers download buttons and delete for a completed download-only job', async () => {
		const w = await mountSuspended(Card, {
			props: { job: job({ status: 'completed', downloadOnly: true, adapterSize: 2048 }) }
		});
		expect(w.text()).toContain('Download Weights');
		expect(w.text()).toContain('Download Config');
		expect(w.text()).toContain('Not Cloudflare-deployable');
		expect(w.text()).toContain('Delete');
		// terminal -> no abort
		expect(w.text()).not.toContain('Abort');
	});

	it('warns when a completed cf-deployable job lost its adapter', async () => {
		const w = await mountSuspended(Card, {
			props: { job: job({ status: 'completed', downloadOnly: false, adapterId: null }) }
		});
		expect(w.text()).toContain('Adapter deleted');
	});

	it('shows the attempt counter when retried', async () => {
		const w = await mountSuspended(Card, {
			props: { job: job({ attempt: 3 }) }
		});
		expect(w.text()).toContain('Attempt 3');
	});

	it('emits open when Details is clicked', async () => {
		const j = job();
		const w = await mountSuspended(Card, { props: { job: j } });
		const detailsBtn = w.findAll('button').find((b) => b.text().includes('Details'));
		await detailsBtn!.trigger('click');
		expect(w.emitted('open')).toBeTruthy();
	});

	it('toggles the log view button label', async () => {
		const w = await mountSuspended(Card, { props: { job: job() } });
		const viewBtn = w.findAll('button').find((b) => b.text().includes('View Logs'));
		expect(viewBtn).toBeTruthy();
		await viewBtn!.trigger('click');
		expect(w.text()).toContain('Hide Logs');
	});

	it('emits relaunch for an aborted job via retry', async () => {
		const w = await mountSuspended(Card, { props: { job: job({ status: 'aborted' }) } });
		const retryBtn = w.findAll('button').find((b) => b.text().includes('Retry'));
		await retryBtn!.trigger('click');
		expect(w.emitted('relaunch')).toBeTruthy();
	});
});
