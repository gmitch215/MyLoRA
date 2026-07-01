import { defineNuxtConfig } from 'nuxt/config';

import tailwindcss from '@tailwindcss/vite';

const E2E_BUILD = process.env.MYLORA_E2E_BUILD === '1';

export default defineNuxtConfig({
	...(process.env.NUXT_BUILD_DIR ? { buildDir: process.env.NUXT_BUILD_DIR } : {}),
	...(E2E_BUILD ? { sourcemap: { client: true, server: true } } : {}),
	site: {
		url: process.env.NUXT_PUBLIC_SITE_URL || 'https://mylora.pages.dev'
	},
	runtimeConfig: {
		password: process.env.NUXT_PASSWORD || 'password',
		session: {
			password:
				process.env.NUXT_SESSION_PASSWORD ||
				(process.env.NODE_ENV === 'production'
					? ''
					: 'dev_only_session_secret_at_least_32_chars_long_xx'),
			cookie: {
				sameSite: 'lax',
				httpOnly: true,
				path: '/',
				// the e2e build serves over http on 127.0.0.1; a Secure cookie is dropped by
				// playwright's api request context there, so force it off for that build only
				secure: !E2E_BUILD && process.env.NODE_ENV === 'production'
			}
		},
		analyticsSalt: process.env.NUXT_ANALYTICS_SALT || 'dev_analytics_salt_change_me_please',
		encryptionKey: process.env.NUXT_ENCRYPTION_KEY || '',
		mockCf: process.env.MYLORA_MOCK_CF === '1',
		cf: {
			accountId: process.env.NUXT_CF_ACCOUNT_ID || '',
			apiToken: process.env.NUXT_CF_API_TOKEN || ''
		},
		public: {
			// only the dedicated e2e-coverage build sets this; enables the hydration marker plugin
			// (which is otherwise import.meta.dev-only) so waitForHydration works against the build
			e2e: E2E_BUILD,
			site_url: process.env.NUXT_PUBLIC_SITE_URL,
			name: process.env.NUXT_PUBLIC_NAME || 'MyLoRA',
			description: process.env.NUXT_PUBLIC_DESCRIPTION || 'A self-hostable LoRA adapter registry',
			author: process.env.NUXT_PUBLIC_AUTHOR || 'Gregory Mitchell',
			themeColor: process.env.NUXT_PUBLIC_THEME_COLOR || '#6d28d9',
			favicon: process.env.NUXT_PUBLIC_FAVICON || '/_favicon.ico',
			faviconPng: process.env.NUXT_PUBLIC_FAVICON_PNG || '/_favicon.png',
			website: process.env.NUXT_PUBLIC_WEBSITE || '',
			github: process.env.NUXT_PUBLIC_GITHUB || '',
			instagram: process.env.NUXT_PUBLIC_INSTAGRAM || '',
			twitter: process.env.NUXT_PUBLIC_TWITTER || '',
			patreon: process.env.NUXT_PUBLIC_PATREON || '',
			linkedin: process.env.NUXT_PUBLIC_LINKEDIN || '',
			discord: process.env.NUXT_PUBLIC_DISCORD || '',
			supportEmail: process.env.NUXT_PUBLIC_SUPPORT_EMAIL || ''
		}
	},
	ssr: true,
	compatibilityDate: '2025-12-13',
	devtools: {
		enabled: process.env.NODE_ENV === 'development' && process.env.MYLORA_MOCK_CF !== '1'
	},
	srcDir: 'src',
	serverDir: 'src/server',
	imports: {
		dirs: ['shared']
	},
	css: ['~/assets/css/main.css'],
	vite: {
		cacheDir: process.env.NUXT_VITE_CACHE || undefined,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		plugins: [tailwindcss() as any],
		css: {
			devSourcemap: true,
			transformer: 'lightningcss'
		},
		build: {
			cssMinify: 'lightningcss'
		},
		optimizeDeps: {
			include: [
				'highlight.js',
				'marked',
				'zod',
				'@vue/devtools-core',
				'@vue/devtools-kit',
				'@unhead/schema-org/vue',
				'@unovis/vue',
				'highlight.js/lib/common',
				'luxon'
			]
		}
	},
	hub: {
		dir: process.env.NUXT_HUB_DIR || '.data',
		cache: true,
		kv: process.env.NUXT_HUB_KV_BASE ? { base: process.env.NUXT_HUB_KV_BASE } : true,
		blob: true,
		db: 'sqlite'
	},
	// the real deploy build keeps the cloudflare preset; the e2e-coverage build opts out so it can
	// run under a plain node preview server (nuxthub falls back to its fs/sqlite drivers there)
	$production: E2E_BUILD
		? {}
		: {
				nitro: {
					preset: 'cloudflare-durable',
					cloudflare: {
						deployConfig: true,
						nodeCompat: true
					}
				}
			},
	nitro: {
		...(E2E_BUILD ? { preset: 'node-server' } : {}),
		imports: {
			dirs: ['src/shared']
		},
		prerender: {
			routes: ['/sitemap.xml'],
			ignore: ['/api/**']
		},
		routeRules: {
			'/api/**': { prerender: false, cors: true },
			'/favicon.png': { headers: { 'Cache-Control': 'public, max-age=31536000' } },
			'/favicon.ico': { headers: { 'Cache-Control': 'public, max-age=31536000' } }
		}
	},
	modules: [
		'@nuxthub/core',
		'nuxt-auth-utils',
		'@nuxt/ui',
		// nuxt-viewport's client plugin throws a harmless teardown race in the vitest nuxt env and
		// nothing in src uses useViewport, so skip it under VITEST (dev/build/e2e keep it)
		...(process.env.VITEST ? [] : ['nuxt-viewport']),
		'@nuxtjs/robots',
		'@nuxtjs/sitemap',
		'nuxt-schema-org',
		'@nuxt/image',
		'@nuxt/hints',
		'@pinia/nuxt',
		'@vueuse/nuxt',
		[
			'@nuxtjs/google-fonts',
			{
				families: {
					'Noto+Sans': true
				},
				display: 'swap',
				preload: true,
				prefetch: true,
				preconnect: true
			}
		],
		[
			'@nuxt/icon',
			{
				icon: {
					mode: 'css',
					cssLayer: 'base',
					size: '48px'
				}
			}
		],
		[
			'@codecov/nuxt-plugin',
			{
				enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
				bundleName: 'mylora',
				uploadToken: process.env.CODECOV_TOKEN
			}
		]
	],
	image: {
		quality: 85,
		format: ['webp', 'avif'],
		screens: {
			xs: 320,
			sm: 640,
			md: 768,
			lg: 1024,
			xl: 1280,
			xxl: 1536
		},
		presets: {
			thumbnail: {
				modifiers: {
					format: 'webp',
					quality: 85,
					fit: 'cover'
				}
			}
		}
	},
	routeRules: {
		'/_ipx/**': {
			headers: {
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		}
	},
	experimental: {
		renderJsonPayloads: true,
		viewTransition: true
	}
});
