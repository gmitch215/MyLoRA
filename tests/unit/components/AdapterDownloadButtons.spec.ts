import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import DownloadButtons from '~/components/adapter/DownloadButtons.vue';

function adapter(extra: Record<string, unknown> = {}) {
	return {
		id: 'a1',
		configBytes: 0,
		weightsBytes: 0,
		downloadCount: 0,
		...extra
	} as any;
}

describe('AdapterDownloadButtons', () => {
	it('disables both buttons when there are no assets', async () => {
		const w = await mountSuspended(DownloadButtons, { props: { adapter: adapter() } });
		const btns = w.findAllComponents({ name: 'UButton' });
		expect(btns[0]!.props('disabled')).toBe(true);
		expect(btns[1]!.props('disabled')).toBe(true);
	});

	it('enables buttons when assets exist and shows sizes', async () => {
		const w = await mountSuspended(DownloadButtons, {
			props: { adapter: adapter({ configBytes: 1024, weightsBytes: 2048, downloadCount: 12 }) }
		});
		const btns = w.findAllComponents({ name: 'UButton' });
		expect(btns[0]!.props('disabled')).toBe(false);
		expect(btns[1]!.props('disabled')).toBe(false);
		expect(w.text()).toContain('12 downloads');
	});

	it('links the download endpoints', async () => {
		const w = await mountSuspended(DownloadButtons, {
			props: { adapter: adapter({ configBytes: 1, weightsBytes: 1 }) }
		});
		const html = w.html();
		expect(html).toContain('/api/adapters/a1/download/config');
		expect(html).toContain('/api/adapters/a1/download/weights');
	});
});
