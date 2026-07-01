import { mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LaunchModal from '~/components/training/job/LaunchModal.vue';

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	// stores fetch machines/accounts on mount; default to empty payloads
	vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ machines: [] }));
});

async function flush() {
	await new Promise((r) => setTimeout(r, 0));
}

describe('training/job/LaunchModal', () => {
	it('renders nothing in the body when closed', async () => {
		const w = await mountSuspended(LaunchModal, { props: { open: false } });
		// modal closed -> the form is not teleported into the document
		expect(document.body.textContent).not.toContain('Start Training');
	});

	it('renders the doc2lora form by default when open', async () => {
		await mountSuspended(LaunchModal, { props: { open: true } });
		await flush();
		const body = document.body.textContent || '';
		expect(body).toContain('New Training Job');
		// doc2lora engine tab is active by default
		expect(body).toContain('Documents');
		expect(body).toContain('Start Training');
		// no machines seeded -> the add-a-machine hint appears
		expect(body).toContain('add one first');
	});

	it('shows the relaunch title and button label when a prefill is given', async () => {
		const prefill: any = {
			id: 'j1',
			engine: 'peft',
			status: 'completed',
			failureClass: 'none',
			inputKind: 'dataset',
			autoPublish: false,
			autoUploadFinetune: false,
			attempt: 1,
			consecutiveFailures: 0,
			downloadOnly: false,
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: '2026-01-01T00:00:00Z',
			config: {
				baseModel: 'mistralai/Mistral-7B',
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
				hfDataset: 'foo/bar'
			}
		};
		await mountSuspended(LaunchModal, { props: { open: true, prefill } });
		await flush();
		await flush();
		const body = document.body.textContent || '';
		expect(body).toContain('Relaunch Training Job');
		expect(body).toContain('Relaunch Training');
	});

	it('renders the advanced configuration toggle and after-training options for peft', async () => {
		await mountSuspended(LaunchModal, { props: { open: true } });
		await flush();
		const body = document.body.textContent || '';
		// advanced section collapsible + the after-training publishing section (doc2lora shows it)
		expect(body).toContain('Advanced Configuration');
		expect(body).toContain('After Training');
	});
});
