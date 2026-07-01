import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import TrainingNotifications from '~/components/training/TrainingNotifications.client.vue';

const unseen = ref(0);
const start = vi.fn();
const stop = vi.fn();
const clearUnseen = vi.fn(() => {
	unseen.value = 0;
});

mockNuxtImport('useTrainingNotifications', () => () => ({
	start,
	stop,
	unseen,
	clearUnseen,
	check: vi.fn()
}));

describe('training/TrainingNotifications', () => {
	it('starts the poller on mount', async () => {
		unseen.value = 0;
		await mountSuspended(TrainingNotifications);
		expect(start).toHaveBeenCalled();
	});

	it('hides the chip text at zero and shows an exact count under ten', async () => {
		unseen.value = 4;
		const w = await mountSuspended(TrainingNotifications);
		expect(w.findComponent({ name: 'UChip' }).props('text')).toBe('4');
	});

	it('caps the chip text at 9+ for large counts', async () => {
		unseen.value = 42;
		const w = await mountSuspended(TrainingNotifications);
		expect(w.findComponent({ name: 'UChip' }).props('text')).toBe('9+');
	});

	it('clears the unseen count on click', async () => {
		unseen.value = 3;
		const w = await mountSuspended(TrainingNotifications);
		await w.findComponent({ name: 'UButton' }).trigger('click');
		expect(clearUnseen).toHaveBeenCalled();
	});
});
