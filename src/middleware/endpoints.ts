export default defineNuxtRouteMiddleware(() => {
	const auth = useAuthStore();
	if (!auth.loggedIn) return navigateTo('/?login=1');

	// registering an endpoint points the tester at a url, so it takes the machine-management capability
	if (!auth.can('canManageMachines')) {
		return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }));
	}
});
