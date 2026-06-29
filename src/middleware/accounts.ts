export default defineNuxtRouteMiddleware(() => {
	const auth = useAuthStore();
	if (!auth.loggedIn) return navigateTo('/?login=1');
	if (!auth.can('canManageAccounts')) {
		return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }));
	}
});
