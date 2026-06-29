# MyLoRA

> A self-hostable registry for LoRA fine-tune adapters, powered by Nuxt UI v4 and Cloudflare Workers.

MyLoRA lets developers upload LoRA adapters (config + weights + screenshots), browse them in a
grid, download them, and once an adapter is published to Cloudflare Workers AI, test them with a
rate-limited inference widget.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gmitch215/MyLoRA)

---

![Screenshot of MyLoRA](/.github/comparison.png)

## Features

- **Adapter registry** - upload `adapter_config.json` + `adapter_model.safetensors`, plus
  screenshots, descriptions (Markdown), examples, prompt templates, tags, and per-adapter visibility.
- **Browse + download** - searchable, filterable, sortable grid; public config/weights downloads
  with download analytics.
- **Inference testing** - a per-adapter, rate-limited chat widget for published adapters, plus an
  unlimited `/playground` for developers.
- **Hybrid Cloudflare accounts** - register shared accounts or let developers bring their own;
  tokens are stored with envelope encryption and never returned by the API.
- **Roles + configurable permissions** - `administrator` / `manager` / `developer` with a
  settings-driven capability matrix (who can edit, delete, publish, manage accounts, bypass limits).
- **Configurable, dual rate limits** - per-hour prompt and output-token budgets for anonymous and
  developer tiers, set during onboarding.
- **First-run onboarding** - creates the root admin and optionally configures rate limits, publish
  permission, and access policy.
- **Analytics dashboard** - views, unique visitors, downloads, devices, and top adapters.
- **Light/dark mode**, SEO, sitemap, and schema.org out of the box.

## Tech stack

- [Nuxt 4](https://nuxt.com/) + [Nuxt UI v4](https://ui.nuxt.com/) (incl. Chat + Dashboard components)
- [NuxtHub](https://hub.nuxt.com/) on Cloudflare Workers
- Cloudflare D1 (Drizzle ORM), KV, R2, and Workers AI
- [Pinia](https://pinia.vuejs.org/) stores, [Zod](https://zod.dev/) validation
- [Playwright](https://playwright.dev/) E2E with monocart coverage

## Configuration (environment variables)

| Variable                | Description                                                     | Required          |
| ----------------------- | --------------------------------------------------------------- | ----------------- |
| `NUXT_SESSION_PASSWORD` | 32+ char secret sealing session cookies                         | yes (prod)        |
| `NUXT_ENCRYPTION_KEY`   | 32+ char KEK for envelope-encrypting Cloudflare tokens          | recommended       |
| `NUXT_ANALYTICS_SALT`   | Secret used to derive daily visitor + IP hashes                 | yes for analytics |
| `NUXT_PASSWORD`         | Optional one-time admin bootstrap (else use `/setup`)           | no                |
| `NUXT_CF_ACCOUNT_ID`    | Optional default Cloudflare account id (the deployment account) | no                |
| `NUXT_CF_API_TOKEN`     | Optional bootstrap token for the default account                | no                |
| `MYLORA_MOCK_CF`        | `1` mocks all Cloudflare calls (tests/dev only; never in prod)  | no                |
| `NUXT_PUBLIC_*`         | Branding + social links (name, description, theme color, etc.)  | no                |

If `NUXT_ENCRYPTION_KEY` is unset, a key is auto-generated and persisted in KV; set it explicitly
in production so it survives across environments. If the key ever changes, stored Cloudflare tokens
must be re-entered (a KV sentinel detects the mismatch and surfaces a clear error).

## Cloudflare Workers AI (LoRA)

Inference uses the **native** Cloudflare Workers AI binding (`process.env.AI`, declared as
`"ai": { "binding": "AI" }` in `wrangler.jsonc`). The binding targets the deployment's account;
adapters hosted on other registered accounts are run via the REST API with that account's token.

Supported BYO base models (verified against the catalog and retained per the 2026-05 deprecations):

- `@cf/mistral/mistral-7b-instruct-v0.2-lora` (mistral)
- `@cf/google/gemma-7b-it-lora` (gemma)
- `@cf/google/gemma-2b-it-lora` (gemma)
- `@cf/meta-llama/llama-2-7b-chat-hf-lora` (llama)

Adapter limits: rank <= 32, safetensors < 300MB, non-quantized, 100 adapters per account.
`adapter_config.json` must carry a `model_type` (mistral/gemma/llama) - MyLoRA injects it from your
metadata automatically. Cloudflare does not yet expose single-GET or DELETE finetune endpoints;
MyLoRA stubs them behind the `cfGetEnabled` / `cfDeleteEnabled` feature flags so real slot
reclamation can be turned on the moment Cloudflare ships them. Until then, deleting an adapter is a
soft delete and the finetune slot stays consumed.

## Local development

```bash
bun install
bun run dev            # http://localhost:8787
```

On first run, every visitor is redirected to `/setup` to create the root administrator.

### Scripts

- `bun run dev` - dev server on port 8787
- `bun run dev:test` - dev server with the test env (`.config/test.env`, `MYLORA_MOCK_CF=1`)
- `bun run build` - production build (Cloudflare module preset)
- `bun run test` / `bun run test:coverage` - Playwright E2E (auto-starts the dev:test server)
- `bun run prettier` / `bun run prettier:check` - format / check

## Project structure

```
src/
  app.vue, error.vue           # root + error boundary
  layouts/                     # default (navbar/footer) + dashboard (sidebar)
  pages/                       # grid, adapters/[slug], playground, dashboard/*, admin, setup, ...
  components/                  # AdapterCard, AdapterForm(Modal), InferenceWidget, PlaygroundChat, ...
  stores/                      # Pinia: auth, adapters, upload, inference, cfAccounts, settings, ...
  composables/                 # thin wrappers (useLogin, useSettings, useMarkdown, useAnalytics)
  shared/                      # Zod schemas, types, settings defaults
  server/
    api/                       # auth, adapters, cf-accounts, infer, analytics, settings, users
    db/schema.ts               # Drizzle schema (users, cloudflare_accounts, adapters, downloads)
    utils/                     # db, auth, crypto (envelope), settings, ratelimit, cloudflare, inference
    middleware/, plugins/, routes/
tests/                         # Playwright api/ + UI specs, utils, fixtures
```

## Storage layout

- **D1** - relational metadata (`users`, `cloudflare_accounts`, `adapters`, `downloads`).
- **R2** - adapter files (`adapters/{id}/adapter_config.json`, `.../adapter_model.safetensors`,
  `.../screenshots/*`) and avatars.
- **KV** - settings, session password, rate-limit counters, push-job state, encryption sentinel,
  analytics rollups. Read-heavy feeds use Nitro's cache (backed by the `CACHE` namespace).

## License

MIT.
