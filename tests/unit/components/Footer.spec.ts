import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import Footer from '~/components/Footer.vue';

// Footer reads settings through useSettings(); control it directly so links toggle deterministically
const settings = ref<any>({});
mockNuxtImport('useSettings', () => () => ({ settings }));

beforeEach(() => {
	settings.value = {};
});

describe('Footer', () => {
	it('renders the copyright with the current year', async () => {
		const w = await mountSuspended(Footer);
		expect(w.text()).toContain(String(new Date().getFullYear()));
		expect(w.text()).toContain('All Rights Reserved');
		expect(w.text()).toContain('powered by');
	});

	it('renders no social links when settings are empty', async () => {
		const w = await mountSuspended(Footer);
		const html = w.html();
		expect(html).not.toContain('aria-label="Twitter"');
		expect(html).not.toContain('aria-label="Patreon"');
		expect(html).not.toContain('aria-label="Support Email"');
		expect(w.text()).not.toContain('Support:');
	});

	it('renders each configured social link and support email', async () => {
		settings.value = {
			github: 'gmitch215',
			twitter: 'lora',
			patreon: 'lora',
			supportEmail: 'help@x.com'
		};
		const w = await mountSuspended(Footer);
		const html = w.html();
		expect(html).toContain('aria-label="GitHub"');
		expect(html).toContain('aria-label="Twitter"');
		expect(html).toContain('aria-label="Patreon"');
		expect(html).toContain('aria-label="Support Email"');
		expect(html).toContain('https://x.com/lora');
		expect(w.text()).toContain('Support:');
		expect(w.text()).toContain('help@x.com');
	});
});
