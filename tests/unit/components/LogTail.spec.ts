import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import LogTail from '~/components/training/job/LogTail.vue';

describe('training/job/LogTail', () => {
	it('renders the empty placeholder when there is no log', async () => {
		const w = await mountSuspended(LogTail, { props: { logTail: null } });
		expect(w.text()).toContain('No log output yet.');
		expect(w.find('pre').exists()).toBe(false);
	});

	it('renders the cleaned log in a pre block', async () => {
		const w = await mountSuspended(LogTail, { props: { logTail: 'line one\nline two' } });
		expect(w.find('pre').exists()).toBe(true);
		expect(w.text()).toContain('line one');
		expect(w.text()).toContain('line two');
	});

	it('collapses carriage-return progress redraws to the final frame', async () => {
		const w = await mountSuspended(LogTail, { props: { logTail: '10%\r50%\r100%' } });
		const pre = w.find('pre').text();
		expect(pre).toContain('100%');
		expect(pre).not.toContain('10%');
	});

	it('shows the status message when provided', async () => {
		const w = await mountSuspended(LogTail, {
			props: { logTail: 'x', statusMessage: 'Provisioning the box' }
		});
		expect(w.text()).toContain('Provisioning the box');
	});

	it('omits the status message paragraph when absent', async () => {
		const w = await mountSuspended(LogTail, { props: { logTail: 'x' } });
		// only the pre content, no leading status paragraph text
		expect(w.text().trim()).toBe('x');
	});
});
