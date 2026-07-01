import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import Form from '~/components/adapter/Form.vue';

// stores mocked as plain controllable objects; storeToRefs passes refs through
const create = vi.fn().mockResolvedValue({ id: 'new1', slug: 'my-lora', status: 'draft' });
const update = vi.fn().mockResolvedValue({ id: 'e1', slug: 'edited' });
const adaptersStore = { create, update };

const upload = reactive<any>({
	draftId: null,
	draftSlug: null,
	status: null,
	configState: 'idle',
	weightsState: 'idle',
	uploadProgress: 0,
	uploadConfig: vi.fn().mockResolvedValue(undefined),
	uploadWeights: vi.fn().mockResolvedValue(undefined)
});

const publishStore = {
	states: {} as Record<string, any>,
	preflight: vi
		.fn()
		.mockResolvedValue({ canPublish: true, detail: 'ok', accountLabel: 'Acme', accountId: 'c1' }),
	start: vi.fn().mockResolvedValue(undefined),
	stop: vi.fn(),
	isActive: vi.fn().mockReturnValue(false)
};

const cfAccountsStore = { available: vi.fn().mockResolvedValue([]) };

const can = vi.fn().mockReturnValue(false);
const limits = ref<any>({ maxRank: 64 });
const access = ref<any>({ defaultVisibility: 'public' });

mockNuxtImport('useAdaptersStore', () => () => adaptersStore);
mockNuxtImport('useUploadStore', () => () => upload);
mockNuxtImport('usePublishStore', () => () => publishStore);
mockNuxtImport('useCfAccountsStore', () => () => cfAccountsStore);
mockNuxtImport('useSettingsStore', () => () => ({ limits, access }));
mockNuxtImport('useAuthStore', () => () => ({ can }));
mockNuxtImport('storeToRefs', () => (s: any) => s);
mockNuxtImport('useMarkdown', () => () => ({ renderMarkdown: (s: string) => `<p>${s}</p>` }));
const toastAdd = vi.fn();
mockNuxtImport('useToast', () => () => ({ add: toastAdd }));

// UForm needs a schema/state provider; render its slot and forward submit
const global = {
	stubs: {
		UForm: {
			emits: ['submit'],
			template: '<form @submit.prevent="$emit(\'submit\', {})"><slot /></form>'
		},
		ScreenshotUploader: { template: '<div class="screenshots" />' }
	}
};

function adapter(extra: Record<string, unknown> = {}) {
	return {
		id: 'e1',
		name: 'Editable',
		slug: 'editable',
		description: 'desc',
		baseModel: '@cf/google/gemma-2b',
		modelType: 'gemma',
		rank: 8,
		promptTemplate: '',
		tags: ['x'],
		examples: [],
		iconName: '',
		iconColor: 'primary',
		visibility: 'public',
		status: 'listed',
		screenshots: [],
		...extra
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	can.mockReturnValue(false);
	limits.value = { maxRank: 64 };
	access.value = { defaultVisibility: 'public' };
	upload.configState = 'idle';
	upload.weightsState = 'idle';
	publishStore.states = {};
	vi.stubGlobal('$fetch', vi.fn().mockResolvedValue([]));
});

const flush = () => new Promise((r) => setTimeout(r, 20));

function submitBtn(w: any) {
	return w.findAllComponents({ name: 'UButton' }).find((b: any) => /Save/.test(b.text()));
}

describe('AdapterForm', () => {
	it('renders the core metadata fields in create mode', async () => {
		const w = await mountSuspended(Form, { global, props: { mode: 'create' } });
		expect(w.text()).toContain('Name');
		expect(w.text()).toContain('Slug');
		expect(w.text()).toContain('Description');
		expect(w.text()).toContain('Base Model');
		expect(w.text()).toContain('Save Adapter');
	});

	it('shows the assets-locked hint before a draft exists', async () => {
		const w = await mountSuspended(Form, { global, props: { mode: 'create' } });
		expect(w.text()).toContain('Save the adapter first');
	});

	it('creates a draft on submit and emits the result', async () => {
		const w = await mountSuspended(Form, { global, props: { mode: 'create' } });
		await w.find('form').trigger('submit');
		await flush();
		expect(create).toHaveBeenCalled();
		expect(w.emitted('submit')?.[0]?.[0]).toMatchObject({ id: 'new1' });
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Adapter created' }));
	});

	it('updates an existing adapter on submit in edit mode', async () => {
		const w = await mountSuspended(Form, {
			global,
			props: { mode: 'edit', adapter: adapter() }
		});
		expect(w.text()).toContain('Save Changes');
		await w.find('form').trigger('submit');
		await flush();
		expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Adapter saved' }));
	});

	it('surfaces a save error', async () => {
		create.mockRejectedValueOnce({ data: { statusMessage: 'slug taken' } });
		const w = await mountSuspended(Form, { global, props: { mode: 'create' } });
		await w.find('form').trigger('submit');
		await flush();
		expect(w.text()).toContain('slug taken');
	});

	it('emits cancel from the cancel button', async () => {
		const w = await mountSuspended(Form, { global, props: { mode: 'create' } });
		const cancel = w
			.findAllComponents({ name: 'UButton' })
			.find((b) => b.text().includes('Cancel'));
		await cancel!.trigger('click');
		expect(w.emitted('cancel')).toBeTruthy();
	});

	it('hides the publish section without the canPublish capability', async () => {
		const w = await mountSuspended(Form, {
			global,
			props: { mode: 'edit', adapter: adapter() }
		});
		expect(w.text()).not.toContain('Publish to Cloudflare');
	});

	it('shows the publish section for an editable adapter with canPublish', async () => {
		can.mockImplementation((c: string) => c === 'canPublish');
		const w = await mountSuspended(Form, {
			global,
			props: { mode: 'edit', adapter: adapter() }
		});
		await flush();
		expect(w.text()).toContain('Publish to Cloudflare');
	});

	it('shows the upload progress once a config upload starts', async () => {
		upload.configState = 'uploading';
		upload.uploadProgress = 40;
		const w = await mountSuspended(Form, {
			global,
			props: { mode: 'edit', adapter: adapter() }
		});
		expect(w.findComponent({ name: 'UploadProgress' }).exists()).toBe(true);
	});
});
