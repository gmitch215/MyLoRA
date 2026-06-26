import { defineNuxtConfig } from 'nuxt/config';

import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
	site: {
		url: process.env.NUXT_PUBLIC_SITE_URL || 'https://nuxtpress.pages.dev'
	},
	ssr: true,
	compatibilityDate: '2025-12-13',
	devtools: { enabled: process.env.NODE_ENV === 'development' },
	srcDir: 'src',
	serverDir: 'src/server',
	css: ['~/assets/css/main.css'],
	vite: {
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
				'prosemirror-state',
				'prosemirror-view',
				'prosemirror-model',
				'prosemirror-transform',
				'zod',
				'@vue/devtools-core',
				'@vue/devtools-kit',
				'@unhead/schema-org/vue',
				'@unovis/vue'
			]
		}
	},
	hub: {
		cache: true,
		kv: true,
		blob: true,
		db: 'sqlite'
	},
	$production: {
		nitro: {
			preset: 'cloudflare_module',
			cloudflare: {
				deployConfig: true,
				nodeCompat: true
			}
		}
	},
	nitro: {
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
		'nuxt-viewport',
		'@nuxtjs/robots',
		'@nuxtjs/sitemap',
		'nuxt-schema-org',
		'@nuxt/image',
		'@nuxt/hints',
		'@pinia/nuxt',
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
				bundleName: 'nuxtpress',
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
