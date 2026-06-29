import { and, eq } from 'drizzle-orm';
import { adapters } from '~/server/db/schema';
import { describeCfError, type FinetuneRecord, listFinetunes } from './cloudflare';

const DEFAULT_BASE = '@cf/mistral/mistral-7b-instruct-v0.2-lora';

function modelTypeFor(model?: string): ModelType {
	return (DEFAULT_BASE_MODELS.find((x) => x.model === model)?.modelType as ModelType) ?? 'mistral';
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '') || 'adapter'
	);
}

async function uniqueSlug(base: string): Promise<string> {
	let slug = base;
	let n = 1;
	while (
		(await db.select({ id: adapters.id }).from(adapters).where(eq(adapters.slug, slug)).limit(1))[0]
	) {
		slug = `${base}-${n++}`;
	}
	return slug;
}

// validate an account by listing its finetunes; proves the token + account id + workers ai access
// are all good before we ever store the account or try to use it
export async function validateAccount(
	accountId: string,
	token: string
): Promise<{ ok: boolean; finetunes: FinetuneRecord[]; error?: string }> {
	try {
		const finetunes = await listFinetunes(accountId, token);
		return { ok: true, finetunes };
	} catch (e) {
		return { ok: false, finetunes: [], error: describeCfError(e) };
	}
}

// import finetunes that exist on the account but aren't tracked here as 'migrated' adapters:
// testable + visible, but not downloadable (we don't host their files). returns the import count
export async function importFinetunes(opts: {
	accountRowId: string;
	finetunes: FinetuneRecord[];
	ownerId: string | null;
}): Promise<number> {
	const { accountRowId, finetunes, ownerId } = opts;

	// cache the discovered list + validation timestamp for the account
	try {
		await kv.set(`mylora:cfaccount:${accountRowId}:finetunes`, JSON.stringify(finetunes));
		await kv.set(`mylora:cfaccount:${accountRowId}:validatedAt`, String(Date.now()));
	} catch {
		// non-fatal
	}

	let imported = 0;
	for (const ft of finetunes) {
		if (!ft?.id && !ft?.name) continue;

		// skip anything already tracked on this account (by finetune id, then name)
		const byId = ft.id
			? (
					await db
						.select({ id: adapters.id })
						.from(adapters)
						.where(and(eq(adapters.accountId, accountRowId), eq(adapters.finetuneId, ft.id)))
						.limit(1)
				)[0]
			: undefined;
		const byName =
			!byId && ft.name
				? (
						await db
							.select({ id: adapters.id })
							.from(adapters)
							.where(and(eq(adapters.accountId, accountRowId), eq(adapters.finetuneName, ft.name)))
							.limit(1)
					)[0]
				: undefined;
		if (byId || byName) continue;

		const name = ft.name || ft.id;
		const slug = await uniqueSlug(slugify(name));
		const id = crypto.randomUUID().replace(/-/g, '');
		const now = new Date();
		await db.insert(adapters).values({
			id,
			name,
			slug,
			description:
				'Imported from a connected Cloudflare account. Files are not hosted here, so downloads are unavailable; testing works through the playground.',
			baseModel: ft.model || DEFAULT_BASE,
			modelType: modelTypeFor(ft.model),
			rank: 0,
			configBytes: 0,
			weightsBytes: 0,
			promptTemplate: '',
			tags: 'migrated',
			examples: '[]',
			screenshots: '[]',
			visibility: 'public',
			cfPublic: !!ft.public,
			accountId: accountRowId,
			finetuneId: ft.id,
			finetuneName: ft.name || ft.id,
			authorId: ownerId,
			status: 'migrated',
			createdAt: now,
			updatedAt: now
		});
		imported++;
	}
	return imported;
}
