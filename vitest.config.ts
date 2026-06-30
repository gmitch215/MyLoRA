import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'#shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
			'~': fileURLToPath(new URL('./src', import.meta.url)),
			'@': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/server/utils/remote-commands.ts', 'src/shared/types.ts']
		}
	}
});
