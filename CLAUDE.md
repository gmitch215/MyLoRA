# MyLoRA

MyLoRA is a Nuxt 4 + NuxtHub (Cloudflare Workers) registry for LoRA fine-tune adapters. It is the
LoRA sibling of NuxtPress (`../nuxtpress`) and follows its conventions. Keep changes small and
aligned with the existing Nuxt UI v4 design language.

## Project map

- `src/pages/` - file-based routes (grid, `adapters/[slug]`, playground, `dashboard/*`, admin, setup)
- `src/components/` - UI; adapter cards/forms, the inference widget + playground, settings, cloudflare
- `src/stores/` - Pinia stores (required throughout): auth, adapters, upload, inference, cfAccounts,
  settings, users, analytics
- `src/composables/` - thin wrappers over stores + useMarkdown/useAnalytics/useSetupStatus
- `src/server/api/` - auth, adapters, cf-accounts, infer, analytics, settings, users
- `src/server/db/schema.ts` - Drizzle schema (`users`, `cloudflare_accounts`, `adapters`, `downloads`)
- `src/server/utils/` - db, auth, crypto (envelope), settings, ratelimit, cloudflare, inference, serialize
- `src/shared/` - Zod schemas, types, settings defaults

## Conventions

- SFC order is `<template>` then `<script setup lang="ts">` then `<style>`. Tabs everywhere.
- Comments: terse, lowercase, no trailing period, ASCII only; only where the WHY is non-obvious.
- Bindings: `import { db } from 'hub:db'`, `{ kv } from 'hub:kv'`, `{ blob } from 'hub:blob'`.
  There is NO `hub:ai` or `hub:cache`: AI is the native `process.env.AI` binding; caching is Nitro's
  `cachedEventHandler` (backed by the `CACHE` namespace).
- Select options must never use an empty-string value (Reka SelectItem throws); use an `'all'` sentinel.
- Settings drive permissions/access/rate-limits/features - resolve against settings, not hardcoded roles.
- Cloudflare tokens are envelope-encrypted and never serialized (only `tokenLast4`).

## Commands

- `bun run dev` / `bun run dev:test` (test env + `MYLORA_MOCK_CF=1`)
- `bun run build` - production build (cloudflare_module preset)
- `bun run test` / `bun run test:coverage` - Playwright E2E (mocks Cloudflare via `MYLORA_MOCK_CF`)
- `bun run prettier:check`

## Testing notes

- E2E mocks all Cloudflare/AI calls via `MYLORA_MOCK_CF=1` (honored only when NODE_ENV != production).
- The dev:test server runs with `--max-old-space-size=8192`; it stalls under sustained load with less.
- UI specs use `page.goto(url, { waitUntil: 'domcontentloaded' })` + `waitForHydration` (never
  `networkidle` - Vite HMR keeps the socket open in dev).
- API specs use the `request` fixture; `loginViaApi` skips redundant logins to avoid the auth limiter.
