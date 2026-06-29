import type { Adapter as AdapterRow, User as UserRow } from '~/server/db/schema';

export function toPublicUser(row: Partial<UserRow> | null | undefined): PublicUser | null {
	if (!row || !row.id) return null;
	return {
		id: row.id,
		username: row.username!,
		displayName: row.displayName!,
		role: row.role!,
		avatarPathname: row.avatarPathname ?? null,
		bio: row.bio ?? null
	};
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}

function parseTags(raw: string | null | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
}

// map a db row to the public Adapter shape (parses tags/examples/screenshots)
export function toAdapter(row: AdapterRow, author?: Partial<UserRow> | null): Adapter {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		description: row.description,
		baseModel: row.baseModel,
		modelType: row.modelType,
		rank: row.rank,
		configBytes: row.configBytes,
		weightsBytes: row.weightsBytes,
		promptTemplate: row.promptTemplate,
		tags: parseTags(row.tags),
		examples: parseJsonArray<AdapterExampleItem>(row.examples),
		screenshots: parseJsonArray<string>(row.screenshots),
		iconName: row.iconName,
		iconColor: row.iconColor,
		visibility: row.visibility,
		cfPublic: row.cfPublic,
		accountId: row.accountId,
		finetuneId: row.finetuneId,
		finetuneName: row.finetuneName,
		authorId: row.authorId,
		author: author ? toPublicUser(author) : null,
		status: row.status,
		statusMessage: row.statusMessage,
		downloadCount: row.downloadCount,
		inferenceCount: row.inferenceCount,
		created_at: new Date(row.createdAt),
		updated_at: new Date(row.updatedAt)
	};
}
