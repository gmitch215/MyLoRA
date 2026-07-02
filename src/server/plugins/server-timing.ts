export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('request', (event) => {
		if (event.path?.startsWith('/api/')) event.context._t0 = Date.now();
	});
	nitroApp.hooks.hook('beforeResponse', (event) => {
		const t0 = event.context._t0 as number | undefined;
		if (t0) setResponseHeader(event, 'Server-Timing', `app;dur=${Date.now() - t0}`);
	});
});
