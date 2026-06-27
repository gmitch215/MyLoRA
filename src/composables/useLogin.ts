// thin wrapper over the auth store so pages get familiar names
export function useLogin() {
	const store = useAuthStore();
	const { loggedIn, user, isAdmin, isManager } = storeToRefs(store);
	return {
		loggedIn,
		user,
		isAdmin,
		isManager,
		login: store.login,
		logout: store.logout
	};
}
