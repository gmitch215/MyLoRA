export default defineNuxtRouteMiddleware(() => {
	const auth = useAuthStore();
	if (!auth.loggedIn) return navigateTo('/?login=1');

	// machines + training pages are open to trainers and machine managers
	if (!auth.can('canTrain') && !auth.can('canManageMachines')) {
		return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }));
	}
});
