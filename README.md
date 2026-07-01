# 🧩 MyLoRA

> A self-hostable registry for LoRA fine-tune adapters, powered by Nuxt UI v4 and Cloudflare Workers.

MyLoRA lets developers upload LoRA adapters (config + weights + screenshots), browse them in a
grid, download them, and - once an adapter is published to Cloudflare Workers AI - test them in a
rate-limited inference widget. It can even **train adapters for you**: register a remote GPU
machine, upload documents or point at a HuggingFace dataset, and MyLoRA drives the whole fine-tune
over SSH - provision, train, verify, sync back, and optionally publish - with no browser left open. 🚀

<p align="center">
  <img alt="Nuxt 4" src="https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white" />
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

---

![Screenshot of MyLoRA](/.github/comparison.png)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gmitch215/MyLoRA)

## ✨ Features

- 📦 **Adapter Registry** - upload `adapter_config.json` + `adapter_model.safetensors`, plus
  screenshots, descriptions (Markdown), examples, prompt templates, tags, and per-adapter visibility.
- 🤖 **Remote Training** - register a remote GPU machine (VPS or a home box over an SSH tunnel) and
  let MyLoRA fine-tune adapters for you end to end: doc2lora (documents -> LoRA), PEFT (HuggingFace
  dataset -> LoRA), or Accelerate (diffusers text-to-image LoRA). Live status, phase-aware ETA,
  machine telemetry, loss/grad-norm/LR/epoch charts, and optional auto-publish. See
  [Remote Training](#-remote-training) below.
- 🔎 **Browse + Download** - searchable, filterable, sortable grid; public config/weights downloads
  with download analytics.
- 💬 **Inference Testing** - a per-adapter, rate-limited chat widget for published adapters, plus an
  unlimited `/playground` for developers with a side-by-side compare mode for two adapters/models.
- 🔐 **Hybrid Cloudflare Accounts** - register shared accounts or let developers bring their own;
  tokens are stored with envelope encryption and never returned by the API.
- 👥 **Roles + Configurable Permissions** - `administrator` / `manager` / `developer` with a
  settings-driven capability matrix (who can edit, delete, publish, manage Cloudflare accounts,
  manage training machines, launch training jobs, bypass limits).
- 🚦 **Configurable, Dual Rate Limits** - per-hour prompt and output-token budgets for anonymous and
  developer tiers, set during onboarding.
- 🧭 **First-Run Onboarding** - creates the root admin and optionally configures rate limits, publish
  permission, and access policy.
- 📊 **Analytics Dashboard** - views, unique visitors, downloads, devices, top adapters, plus
  inference and training-run rollups (by status/GPU).
- 🌓 **Light/Dark Mode**, SEO, sitemap, and schema.org out of the box.

## 🧱 Tech Stack

- [Nuxt 4](https://nuxt.com/) + [Nuxt UI v4](https://ui.nuxt.com/) (incl. Chat + Dashboard components)
- [NuxtHub](https://hub.nuxt.com/) on Cloudflare Workers
- Cloudflare D1 (Drizzle ORM), KV, R2, Workers AI, and a Durable Object (per-job training scheduler)
- [edgeport](https://github.com/gmitch215/edgeport) - Workers-native SSH/SFTP (the remote-training transport)
- [doc2lora](https://github.com/earth-app/doc2lora) + PEFT / Accelerate as the training engines (run on your machine)
- [Pinia](https://pinia.vuejs.org/) stores, [Zod](https://zod.dev/) validation
- [Playwright](https://playwright.dev/) E2E (monocart coverage) + [Vitest](https://vitest.dev/) unit tests

## ⚙️ Configuration (Environment Variables)

| Variable                | Description                                                            | Required          |
| ----------------------- | ---------------------------------------------------------------------- | ----------------- |
| `NUXT_SESSION_PASSWORD` | 32+ char secret sealing session cookies                                | yes (prod)        |
| `NUXT_ENCRYPTION_KEY`   | 32+ char KEK for envelope-encrypting Cloudflare tokens                 | recommended       |
| `NUXT_ANALYTICS_SALT`   | Secret used to derive daily visitor + IP hashes                        | yes for analytics |
| `NUXT_PASSWORD`         | Optional one-time admin bootstrap (else use `/setup`)                  | no                |
| `NUXT_CF_ACCOUNT_ID`    | Optional default Cloudflare account id (the deployment account)        | no                |
| `NUXT_CF_API_TOKEN`     | Optional bootstrap token for the default account                       | no                |
| `MYLORA_MOCK_CF`        | `1` mocks all Cloudflare AND SSH calls (tests/dev only; never in prod) | no                |
| `NUXT_PUBLIC_*`         | Branding + social links (name, description, theme color, etc.)         | no                |

> 💡 If `NUXT_ENCRYPTION_KEY` is unset, a key is auto-generated and persisted in KV; set it explicitly
> in production so it survives across environments. If the key ever changes, stored Cloudflare tokens
> must be re-entered (a KV sentinel detects the mismatch and surfaces a clear error).

## ☁️ Cloudflare Workers AI (LoRA)

Inference uses the **native** Cloudflare Workers AI binding (`process.env.AI`, declared as
`"ai": { "binding": "AI" }` in `wrangler.jsonc`). The binding targets the deployment's account;
adapters hosted on other registered accounts are run via the REST API with that account's token.

Curated base models (each carries both its Cloudflare catalog id and, for training, the HuggingFace
repo the LoRA is fine-tuned against):

- `@cf/mistral/mistral-7b-instruct-v0.2-lora` (mistral)
- `@cf/google/gemma-7b-it-lora`, `@cf/google/gemma-2b-it-lora`, `@cf/google/gemma-3-12b-it` (gemma)
- `@cf/meta-llama/llama-2-7b-chat-hf-lora`, `@cf/meta/llama-3.2-11b-vision-instruct`,
  `@cf/meta/llama-guard-3-8b` (llama)
- `@cf/qwen/qwq-32b`, `@cf/qwen/qwen2.5-coder-32b-instruct` (qwen)

PEFT / Accelerate runs may target any HuggingFace repo; a base that is not Cloudflare-deployable
produces a download-only adapter (no catalog row).

**Adapter limits:** rank <= 32, safetensors < 300MB, non-quantized, 100 adapters per account.
`adapter_config.json` must carry a `model_type` (mistral/gemma/llama/qwen) - MyLoRA injects it from
your metadata automatically.

**📤 Publish flow.** Publishing pushes the adapter to the account's finetune catalog: `POST /ai/finetunes`
(model + name + description), then uploads `adapter_model.safetensors` and `adapter_config.json` to
`/finetune-assets`. The hosting account is chosen explicitly in the publish modal (else the adapter's
pinned account, else the default, else a shared account with a free slot), and a side-effect-free
preflight verifies the token can create finetunes before anything runs.

> ⚠️ The API token **must have the `Workers AI: Edit` permission** - a read-only token can list
> finetunes but not publish (MyLoRA surfaces the exact Cloudflare error, including the request URL,
> when it can't).

Cloudflare does not yet expose single-GET or DELETE finetune endpoints; MyLoRA stubs them behind the
`cfGetEnabled` / `cfDeleteEnabled` feature flags. Until then, deleting an adapter is a soft delete and
the finetune slot stays consumed.

## 🤖 Remote Training

MyLoRA can fine-tune adapters on a machine you own and stream the whole run back - no local GPU, no
browser left open. The Worker drives everything over SSH/SFTP (via edgeport); the box holds **zero
cloud credentials**, only an `authorized_keys` entry.

### 🖥️ Machines

Register a GPU VPS or a home box exposed over an SSH tunnel. Auth is a platform-generated Ed25519
keypair (default), a pasted private key, or a password - all envelope-encrypted, view-once, and
update-only. **Test Connection** preflights the box (GPUs + VRAM, CPU/RAM/disk, OS, python/pip, sudo,
and any HuggingFace token already in the environment); health auto-refreshes when you open the
Machines tab and re-tests automatically when you change a machine's host/port. **Prepare Machine**
warms a persistent uv wheel cache so future job venvs install in seconds. Health also surfaces
`running` and `at_capacity` (GPU VRAM >= 80%).

### 🛠️ Engines

- **doc2lora** - upload documents (PDF/DOCX/HTML/etc.); doc2lora extracts text and trains a LoRA. Its
  `scan` gives a real per-machine time estimate that replaces the rough byte-based one.
- **PEFT** - point at a HuggingFace dataset id (no upload); trains a causal-LM LoRA.
- **Accelerate** - diffusers text-to-image LoRA from a HuggingFace image dataset (download-only).

### 🚀 Launch + Lifecycle

Pick the engine, base model, rank/epochs/LR/etc., an optional per-job HuggingFace token (or reuse the
box's), an optional custom output name/slug, and optional `sudo` (password supplied per-launch, never
stored). The job then walks:

```text
queued -> provisioning -> launching -> running -> syncing -> verifying -> publishing -> completed
```

The Worker creates a uv-managed venv, installs the engine, launches a detached run, polls it, and
pulls the adapter back into R2 with a **sha256 + size integrity gate** before creating the catalog
row - with optional auto-publish and auto-upload to the finetune catalog.

### 📈 Live + Completion

Status chips, a phase-aware ETA (install / model-download / training, so the countdown never burns
down during a download), and live telemetry (CPU/GPU/VRAM/RAM/disk/bandwidth). On completion the
details modal shows **loss / grad-norm / learning-rate / epoch graphs** (zoom 0.25x-4x, click a point
for exact values, download the SVG), phase timings, training throughput, and buttons to download the
config + weights. Gated HuggingFace models (401) get a dedicated failure class and a non-blocking
pre-launch warning; secrets are redacted from logs; logs persist to R2 for a configurable retention
window (default 90 days).

### ⏱️ Scheduling

A 1-minute cron is the guaranteed driver; a per-job Durable Object alarm advances the tight (~30s)
loop, and an advisory lease serializes the two so a job is never double-driven. Crashed launches are
recovered after a stall window.

## 💻 Local Development

```bash
bun install
bun run dev            # http://localhost:8787
```

On first run, every visitor is redirected to `/setup` to create the root administrator.

### 📜 Scripts

- `bun run dev` - dev server on port 8787
- `bun run dev:test` - dev server with the test env (`.config/test.env`, `MYLORA_MOCK_CF=1`)
- `bun run build` - production build (Cloudflare module preset)
- `bun run test:unit` - Vitest unit tests (pure parsers/builders; no server)
- `bun run test` - full Playwright E2E: the main suite (8787) then the isolated first-run setup flow
- `bun run test:main` / `bun run test:setup` - run each E2E half alone; `test:coverage` adds monocart
- `bun run prettier` / `bun run prettier:check` - format / check

## 🗂️ Project Structure

```text
src/
  app.vue, error.vue           # root + error boundary
  layouts/                     # default (navbar/footer) + dashboard (sidebar)
  pages/                       # grid, adapters/[slug], playground, dashboard/* (incl. machines), admin, setup
  components/                  # adapter/*, training/{job,machine}/* (charts, launch/detail modals), cloudflare/*
  stores/                      # Pinia: auth, adapters, upload, publish, inference, cfAccounts, machines, trainingJobs, analytics, settings
  composables/                 # thin wrappers (useLogin, useSettings, useMarkdown, useAnalytics)
  shared/                      # Zod schemas, types (incl. training/log parsers), settings defaults
  server/
    api/                       # auth, adapters, cf-accounts, infer, analytics, settings, users, machines, training/*
    db/schema.ts               # Drizzle: users, cloudflare_accounts, adapters, downloads, machines, training_jobs
    utils/                     # db, auth, crypto, settings, ratelimit, cloudflare, inference, remote(+commands), training, hostingAccount
    middleware/, plugins/ (training scheduler), routes/
tests/                         # Vitest unit/ + Playwright api/ + UI specs, utils, fixtures
```

## 💾 Storage Layout

- 🗄️ **D1** - relational metadata (`users`, `cloudflare_accounts`, `adapters`, `downloads`,
  `machines`, `training_jobs`).
- 🪣 **R2** - adapter files (`adapters/{id}/adapter_config.json`, `.../adapter_model.safetensors`,
  `.../screenshots/*`), training inputs + outputs (`datasets/{id}/*`, `jobs/{id}/train.log`,
  `jobs/{id}/weights.safetensors` for download-only runs), and avatars.
- ⚡ **KV** - settings, session password, rate-limit counters, push-job state, ephemeral per-launch
  sudo creds (short-TTL, single-use), encryption sentinel, analytics rollups. Read-heavy feeds use
  Nitro's cache (backed by the `CACHE` namespace).
- ⏰ **Durable Object** - NuxtHub's built-in `$DurableObject`, keyed per training job, holds the alarm
  that advances a running job between cron ticks.

## 📄 License

MIT.
