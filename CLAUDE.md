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
- Bump `SCHEMA_VERSION` in `src/server/utils/db.ts` whenever `createSchema` or `ensureColumns` change;
  a deployed instance only re-runs the migration when its KV flag differs from that version.
- Mail goes through `server/utils/mail.ts` (three transports, plus a sink when `MYLORA_MAIL_SINK=1`
  that specs read through `/api/admin/mail/sink`). `users.email` is never part of `PublicUser`.
- Public settings carry a placeholder URL for an uploaded favicon (`toPublicSettings`), never the
  data URL.
- Endpoint urls only reach `fetch` through `endpoint-client.ts`, which re-runs `endpoint-guard.ts`
  (https, public hostname, DoH-resolved public addresses, no redirects). Keys and serve secrets are
  envelope-encrypted and leave the server only as `keyLast4`. Registering one needs `canManageMachines`.
- The serve script (`remote-serve.ts`) installs what a machine lacks, gated by `ToolingSettings`
  (settings `tooling`, per-machine `machines.tooling` overrides, merged by `mergeTooling`). Every
  download goes through `fetch_verified` (retries, outage wait, throttle log, sha256) and every
  failure writes a code from `SERVE_EXIT` to the `exit` file. The script's own log is `serve.log`.
- Measured limits, retest before relying on them: ngrok ignores the version in its download url
  (any version string returns the stable archive), so ngrok cannot be pinned and publishes no
  checksum; the ngrok agent ignores `NGROK_AUTHTOKEN` and reads its token from `--config`; uv
  0.12.15 installs a wheel whose index hash is wrong, so vLLM has no hash check; cloudflared reads
  `TUNNEL_TOKEN` from the environment.
- ngrok authtokens live in `ngrok_tokens` (same envelope helpers as Cloudflare account tokens); a
  serve resolves `auto`, `machine`, `server` (`NUXT_NGROK_AUTHTOKEN`) or a token id in `ngrok-tokens.ts`.
- Auto-import names are global on the server: `verifyToken` already exists in `cloudflare.ts`, so new
  helpers get distinct names. Read the "Duplicated imports" warning from `nuxt prepare`.

## Commands

- `bun run dev` / `bun run dev:test` (test env + `MYLORA_MOCK_CF=1`)
- `bun run build` - production build (cloudflare_module preset)
- `bun run test` - Playwright E2E: main suite (8787) then the isolated setup flow; `test:main` /
  `test:setup` run each half alone, `test:coverage` is main-only
- `bun run prettier:check`

## Testing notes

- E2E mocks all Cloudflare/AI calls via `MYLORA_MOCK_CF=1` (honored only when NODE_ENV != production).
- The dev:test server runs with `--max-old-space-size=8192`; it stalls under sustained load with less.
- UI specs use `page.goto(url, { waitUntil: 'domcontentloaded' })` + `waitForHydration` (never
  `networkidle` - Vite HMR keeps the socket open in dev).
- API specs use the `request` fixture; `loginViaApi` skips redundant logins to avoid the auth limiter.
- `tests/setup.spec.ts` is isolated: `dev:setup` boots a fresh, unseeded server on 8788 (its own
  `.data-setup` + `.nuxt-setup` + kv namespace, no `NUXT_PASSWORD`, wiped each boot) so the genuine
  first-run flow is reproducible. It runs via `bun run test:setup` (`PLAYWRIGHT_SETUP=1` switches the
  single `playwright.config.ts` to the setup project), sequentially after the main run, never alongside dev:test.
