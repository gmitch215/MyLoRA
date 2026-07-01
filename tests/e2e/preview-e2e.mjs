import v8 from 'node:v8';

const flush = () => {
	try {
		v8.takeCoverage();
	} catch {
		// no coverage session (NODE_V8_COVERAGE unset) -> nothing to flush
	}
};

const timer = setInterval(flush, 2000);
timer.unref();

for (const sig of ['SIGTERM', 'SIGINT']) {
	process.on(sig, () => {
		flush();
		process.exit(0);
	});
}

await import('../../.output/server/index.mjs');
