// mark the document once the app has hydrated so e2e tests can wait for interactivity before clicking;
// active in dev and in the dedicated e2e-coverage build (public.e2e), never in the real deploy
export default defineNuxtPlugin((nuxtApp) => {
	if (!import.meta.dev && useRuntimeConfig().public.e2e !== true) return;
	nuxtApp.hook('app:suspense:resolve', () => {
		document.documentElement.dataset.hydrated = 'true';
	});
});
