import { defineVitestProject } from '@nuxt/test-utils/config';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// cheap unit lane (no server): node project for pure logic, nuxt project for
// stores/composables/components; coverage uploads under the codecov `unit` flag
export default defineConfig(async () => ({
	resolve: {
		alias: {
			'#shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
			'~': fileURLToPath(new URL('./src', import.meta.url)),
			'@': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	test: {
		globals: true,
		projects: [
			{
				test: {
					name: 'node',
					environment: 'node',
					include: ['tests/unit/*.{test,spec}.ts', 'tests/unit/{shared,server}/**/*.{test,spec}.ts']
				}
			},
			await defineVitestProject({
				test: {
					name: 'nuxt',
					environment: 'nuxt',
					include: ['tests/unit/{stores,composables,components}/**/*.{test,spec}.ts'],
					setupFiles: ['tests/unit/nuxt-setup.ts']
				}
			})
		],
		coverage: {
			provider: 'v8',
			reportsDirectory: 'coverage',
			reporter: ['text-summary', 'json', 'lcov'],
			include: [
				'src/shared/**',
				'src/stores/**',
				'src/composables/**',
				'src/components/**',
				'src/server/utils/**'
			],
			// db.ts is a thin binding wrapper (no logic); exclude to avoid diluting the number
			exclude: ['**/*.d.ts', 'src/server/utils/db.ts']
		}
	}
}));
