export const useAuthStore = defineStore('auth', () => {
	const session = useUserSession();

	// reactive view of the nuxt-auth-utils session
	const user = computed<PublicUser | null>(() => (session.user.value as PublicUser) ?? null);
	const loggedIn = computed(() => session.loggedIn.value);
	const role = computed<Role | null>(() => user.value?.role ?? null);
	const isAdmin = computed(() => role.value === 'administrator');
	const isManager = computed(() => role.value === 'administrator' || role.value === 'manager');
	const isDeveloper = computed(() => loggedIn.value);

	const error = ref<string | null>(null);
	const pending = ref(false);

	async function login(username: string, password: string) {
		pending.value = true;
		error.value = null;
		try {
			const res = await $fetch<{ ok: boolean; user: PublicUser }>('/api/login', {
				method: 'POST',
				body: { username, password }
			});
			// refresh the session so user/loggedIn reflect the new state
			await session.fetch();
			return res;
		} catch (e: any) {
			error.value = e?.data?.message ?? e?.message ?? 'Login failed';
			throw e;
		} finally {
			pending.value = false;
		}
	}

	async function logout() {
		try {
			await $fetch('/api/logout', { method: 'POST' });
		} catch {
			// ignore network errors on logout; clear locally regardless
		}
		await session.clear();
		await session.fetch();
	}

	async function fetchSession() {
		await session.fetch();
	}

	// resolve the current user's capability from the live settings permission matrix
	function can(capability: keyof Capability): boolean {
		if (!loggedIn.value || !role.value) return false;
		if (role.value === 'administrator') return ADMIN_CAPABILITY[capability];
		// lazy import avoids circular store init
		const settings = useSettingsStore();
		const cap = capabilityFor(role.value, settings.permissions);
		return cap[capability];
	}

	return {
		user,
		loggedIn,
		role,
		isAdmin,
		isManager,
		isDeveloper,
		error,
		pending,
		login,
		logout,
		fetchSession,
		can
	};
});
