import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters } from 'hub:db:schema';
import { ensureDatabase } from '~/server/utils/db';

// GET /adapters/[slug]/install.sh
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const slug = getRouterParam(event, 'slug');
	if (!slug) throw createError({ statusCode: 400, statusMessage: 'No slug provided' });

	const rows = await db.select().from(adapters).where(eq(adapters.slug, slug)).limit(1);
	const adapter = rows[0];
	if (!adapter) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	// only publicly-visible adapters get an installer; private/archived stay hidden
	if (adapter.visibility === 'private' || adapter.status === 'archived') {
		throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	}
	if (adapter.configBytes <= 0 || adapter.weightsBytes <= 0) {
		throw createError({ statusCode: 409, statusMessage: 'Adapter has no uploaded files yet' });
	}

	const origin =
		useRuntimeConfig(event).public.site_url?.replace(/\/$/, '') || getRequestURL(event).origin;
	const configUrl = `${origin}/api/adapters/${adapter.id}/download/config`;
	const weightsUrl = `${origin}/api/adapters/${adapter.id}/download/weights`;

	const script = `#!/usr/bin/env bash
# MyLoRA installer for "${adapter.name}" (${adapter.slug})
# adds this LoRA adapter to YOUR OWN Cloudflare account using your local wrangler login.
# this script never sends your Cloudflare token anywhere; wrangler uses your own auth.
# review it before piping to bash.
set -euo pipefail

ADAPTER="${adapter.slug}"
BASE_MODEL="${adapter.baseModel}"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT

echo "==> Downloading adapter files for \${ADAPTER}"
curl -fSL "${configUrl}" -o "\${DIR}/adapter_config.json"
curl -fSL "${weightsUrl}" -o "\${DIR}/adapter_model.safetensors"

echo "==> Registering the finetune on your Cloudflare account (wrangler)"
npx --yes wrangler ai finetune create "\${BASE_MODEL}" "\${ADAPTER}" "\${DIR}"

echo "==> Done. Run inference with the lora set to \\"\${ADAPTER}\\" on \${BASE_MODEL}"
`;

	setHeader(event, 'Content-Type', 'text/x-shellscript; charset=utf-8');
	setHeader(event, 'Cache-Control', 'public, max-age=300');
	return script;
});
