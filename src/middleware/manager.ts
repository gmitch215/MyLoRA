export default defineNuxtRouteMiddleware(() => {
	const { loggedIn, user } = useUserSession();
	if (!loggedIn.value) {
		return navigateTo('/?login=1');
	}
	const role = user.value?.role;
	if (role !== 'administrator' && role !== 'manager') {
		return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }));
	}
});
