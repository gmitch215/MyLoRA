import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import ProfileForm from '~/components/ProfileForm.vue';

const toastAdd = vi.fn();
const fetchSession = vi.fn();
const user = ref<any>({ displayName: 'Greg', bio: 'hi', avatarPathname: 'me.png' });

mockNuxtImport('useToast', () => () => ({ add: toastAdd }));
mockNuxtImport('useAuthStore', () => () => ({ user, fetchSession }));
// component uses storeToRefs(auth) on the mocked store; pass the refs straight through
mockNuxtImport('storeToRefs', () => (store: any) => store);

beforeEach(() => {
	vi.clearAllMocks();
	user.value = { displayName: 'Greg', bio: 'hi', avatarPathname: 'me.png' };
	stubFetch();
});

// the form loads the saved email prefs on mount, then everything else is the save/avatar calls
function stubFetch(
	prefs = {
		email: 'greg@example.com',
		emailConfirmed: false,
		notifyJobs: true,
		mailEnabled: true
	}
) {
	vi.stubGlobal(
		'$fetch',
		vi.fn(async (url: string) => (url === '/api/users/me/notifications' ? prefs : {}))
	);
}

function patchBody() {
	const call = ($fetch as any).mock.calls.find((c: any[]) => c[0] === '/api/users/me');
	return call[1].body;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

function saveBtn(w: any) {
	return w
		.findAllComponents({ name: 'UButton' })
		.find((b: any) => b.text().includes('Save Changes'));
}

describe('ProfileForm', () => {
	it('renders the fields and the remove button when an avatar exists', async () => {
		const w = await mountSuspended(ProfileForm);
		expect(w.text()).toContain('Display Name');
		expect(w.text()).toContain('Bio');
		expect(w.text()).toContain('Change password');
		expect(w.text()).toContain('Change Avatar');
		expect(w.text()).toContain('Remove');
	});

	it('hides the remove button when there is no avatar', async () => {
		user.value = { displayName: 'Greg', bio: '', avatarPathname: null };
		const w = await mountSuspended(ProfileForm);
		expect(w.text()).not.toContain('Remove');
	});

	it('saves the profile and toasts on success', async () => {
		const w = await mountSuspended(ProfileForm);
		await saveBtn(w)!.trigger('click');
		await flush();
		expect($fetch as any).toHaveBeenCalledWith(
			'/api/users/me',
			expect.objectContaining({ method: 'PATCH' })
		);
		expect(patchBody()).toMatchObject({ email: 'greg@example.com', notifyJobs: true });
		expect(fetchSession).toHaveBeenCalled();
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Profile updated' }));
	});

	it('loads the saved email prefs and says when mail is not set up', async () => {
		stubFetch({ email: '', emailConfirmed: false, notifyJobs: false, mailEnabled: false });
		const w = await mountSuspended(ProfileForm);
		await flush();
		expect(w.text()).toContain('Email Me About Training Jobs');
		expect(w.text()).toContain('Email is not set up on this site yet');
	});

	it('shows the confirmation state of a saved address and resends on request', async () => {
		const w = await mountSuspended(ProfileForm);
		await flush();
		expect(w.text()).toContain('Not Confirmed');
		const resend = w
			.findAllComponents({ name: 'UButton' })
			.find((b: any) => b.text().includes('Resend Confirmation'));
		await resend!.trigger('click');
		await flush();
		expect($fetch as any).toHaveBeenCalledWith(
			'/api/users/me/email-confirmation',
			expect.objectContaining({ method: 'POST' })
		);
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Confirmation sent' }));
	});

	it('shows Confirmed and no resend button for a confirmed address', async () => {
		stubFetch({
			email: 'greg@example.com',
			emailConfirmed: true,
			notifyJobs: true,
			mailEnabled: true
		});
		const w = await mountSuspended(ProfileForm);
		await flush();
		expect(w.text()).toContain('Confirmed');
		expect(w.text()).not.toContain('Resend Confirmation');
	});

	it('keeps the email fields disabled until the saved prefs have loaded', async () => {
		let release: (v: unknown) => void = () => {};
		vi.stubGlobal(
			'$fetch',
			vi.fn(() => new Promise((r) => (release = r)))
		);
		const w = await mountSuspended(ProfileForm);
		expect(w.find('input[type="email"]').attributes('disabled')).toBeDefined();
		release({ email: '', emailConfirmed: false, notifyJobs: false, mailEnabled: true });
		await flush();
		expect(w.find('input[type="email"]').attributes('disabled')).toBeUndefined();
	});

	it('includes password fields in the payload when a new password is set', async () => {
		const w = await mountSuspended(ProfileForm);
		// current + new password inputs live inside the details block
		const pwInputs = w.findAll('input[type="password"]');
		await pwInputs[0]!.setValue('oldpw');
		await pwInputs[1]!.setValue('newpassword');
		await saveBtn(w)!.trigger('click');
		await flush();
		const body = patchBody();
		expect(body.currentPassword).toBe('oldpw');
		expect(body.newPassword).toBe('newpassword');
	});

	it('surfaces a save error', async () => {
		vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ data: { statusMessage: 'Nope' } }));
		const w = await mountSuspended(ProfileForm);
		await saveBtn(w)!.trigger('click');
		await flush();
		expect(w.text()).toContain('Nope');
	});

	it('uploads an avatar file', async () => {
		const w = await mountSuspended(ProfileForm);
		const input = w.find('input[type="file"]');
		const file = new File(['x'], 'a.png', { type: 'image/png' });
		Object.defineProperty(input.element, 'files', { value: [file] });
		await input.trigger('change');
		await flush();
		expect($fetch as any).toHaveBeenCalledWith(
			'/api/users/me/avatar',
			expect.objectContaining({ method: 'POST' })
		);
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Avatar updated' }));
	});

	it('ignores a change event with no file', async () => {
		const w = await mountSuspended(ProfileForm);
		const input = w.find('input[type="file"]');
		Object.defineProperty(input.element, 'files', { value: [] });
		await input.trigger('change');
		await flush();
		expect($fetch as any).not.toHaveBeenCalledWith('/api/users/me/avatar', expect.anything());
	});

	it('removes the avatar', async () => {
		const w = await mountSuspended(ProfileForm);
		const remove = w
			.findAllComponents({ name: 'UButton' })
			.find((b: any) => b.text().includes('Remove'));
		await remove!.trigger('click');
		await flush();
		expect($fetch as any).toHaveBeenCalledWith(
			'/api/users/me/avatar',
			expect.objectContaining({ method: 'DELETE' })
		);
		expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Avatar removed' }));
	});
});
