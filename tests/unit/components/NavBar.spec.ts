import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import NavBar from '~/components/NavBar.vue';

// useSettings is a thin wrapper the component destructures directly (no storeToRefs),
// so a plain mock returning a settings ref is enough to drive branding/social/banner
const settingsRef = ref<Record<string, any>>({});
mockNuxtImport('useSettings', () => () => ({ settings: settingsRef }));

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}));
	settingsRef.value = {};
});

describe('NavBar', () => {
	it('renders the core nav links and the logged-out login button', async () => {
		settingsRef.value = { name: 'MyLoRA', description: 'a registry' };
		const w = await mountSuspended(NavBar);
		expect(w.text()).toContain('MyLoRA');
		expect(w.text()).toContain('a registry');
		// home/tags/about always present via title attrs
		const titles = w.findAll('a').map((a) => a.attributes('title'));
		expect(titles).toContain('Home');
		expect(titles).toContain('Tags');
		expect(titles).toContain('About');
		// logged out -> Log In shown, no playground/dashboard/profile
		expect(w.text()).toContain('Log In');
		expect(titles).not.toContain('Playground');
		expect(titles).not.toContain('Dashboard');
	});

	it('renders social icons only for the configured links', async () => {
		settingsRef.value = {
			name: 'X',
			website: 'https://site.example',
			github: 'octocat',
			twitter: 'jack',
			discord: 'https://discord.gg/abc'
		};
		const w = await mountSuspended(NavBar);
		const labels = w.findAll('a').map((a) => a.attributes('aria-label'));
		expect(labels).toContain('Website');
		expect(labels).toContain('GitHub');
		expect(labels).toContain('Twitter');
		expect(labels).toContain('Discord');
		// github link builds the full profile url
		const gh = w.findAll('a').find((a) => a.attributes('aria-label') === 'GitHub');
		expect(gh!.attributes('href')).toContain('github.com/octocat');
	});

	it('omits social icons when no links are set', async () => {
		settingsRef.value = { name: 'X' };
		const w = await mountSuspended(NavBar);
		const labels = w.findAll('a').map((a) => a.attributes('aria-label'));
		expect(labels).not.toContain('GitHub');
		expect(labels).not.toContain('Discord');
	});

	it('renders the banner when a message is configured', async () => {
		settingsRef.value = {
			name: 'X',
			message: { text: 'Scheduled maintenance', type: 'warning', icon: 'mdi:alert' }
		};
		const w = await mountSuspended(NavBar);
		await new Promise((r) => setTimeout(r, 0));
		await w.vm.$nextTick();
		expect(w.html()).toContain('Scheduled maintenance');
	});

	it('opens the login modal when the login button is clicked', async () => {
		settingsRef.value = { name: 'X' };
		const w = await mountSuspended(NavBar);
		const loginBtn = w.findAll('button').find((b) => b.text().includes('Log In'));
		await loginBtn!.trigger('click');
		await w.vm.$nextTick();
		expect(document.body.textContent).toContain('Log In');
	});
});
