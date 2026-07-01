import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AppCommandPalette from '~/components/AppCommandPalette.vue';

// control the palette open state so the teleported command palette renders
const open = ref(true);
const toggle = vi.fn();
const show = vi.fn();
const hide = vi.fn();
mockNuxtImport('useCommandPalette', () => () => ({ open, toggle, show, hide }));

beforeEach(() => {
	setActivePinia(createPinia());
	vi.clearAllMocks();
	// useFetch(adapters) resolves through $fetch; return a small catalog
	vi.stubGlobal(
		'$fetch',
		vi.fn().mockResolvedValue({
			items: [
				{
					id: 'a1',
					name: 'Cool Adapter',
					slug: 'cool-adapter',
					description: 'a nice one',
					tags: ['fun'],
					baseModel: 'meta/Llama-3',
					iconName: 'mdi:cube'
				}
			]
		})
	);
	open.value = true;
});

async function flush() {
	for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('AppCommandPalette', () => {
	it('renders the base navigate + action commands for a logged-out user', async () => {
		await mountSuspended(AppCommandPalette);
		await flush();
		const body = document.body.textContent || '';
		expect(body).toContain('Navigate');
		expect(body).toContain('Home');
		expect(body).toContain('Tags');
		expect(body).toContain('About');
		// logged-out actions: theme toggle + refresh + login (no logout, no new adapter)
		expect(body).toContain('Actions');
		expect(body).toContain('Refresh Adapters');
		expect(body).toContain('Log In');
		expect(body).not.toContain('Log Out');
		expect(body).not.toContain('Dashboard');
	});

	it('exposes a theme-toggle command', async () => {
		await mountSuspended(AppCommandPalette);
		await flush();
		const body = document.body.textContent || '';
		// colorMode default -> one of the two theme switch labels renders
		expect(/Switch to (Light|Dark) Mode/.test(body)).toBe(true);
	});

	it('renders the fetched adapters group', async () => {
		await mountSuspended(AppCommandPalette);
		await flush();
		const body = document.body.textContent || '';
		expect(body).toContain('Adapters');
		expect(body).toContain('Cool Adapter');
	});

	it('does not teleport palette content when closed', async () => {
		open.value = false;
		await mountSuspended(AppCommandPalette);
		await flush();
		// closed modal -> the search placeholder is not in the document
		expect(document.body.textContent).not.toContain('Search adapters, run a command');
	});
});
