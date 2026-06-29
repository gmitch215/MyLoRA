import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireCapability(event, 'canCreate');
	await ensureDatabase();

	const body = await readBody(event);
	const parsed = adapterCreateSchema.safeParse(body);
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid adapter data')
		});
	}
	const data = parsed.data;

	// ensure a globally unique slug (append -1, -2, ... like nuxtpress)
	let finalSlug = data.slug;
	let counter = 1;
	while (true) {
		const existing = await db
			.select({ id: adapters.id })
			.from(adapters)
			.where(eq(adapters.slug, finalSlug))
			.limit(1);
		if (existing.length === 0) break;
		finalSlug = `${data.slug}-${counter}`;
		counter++;
	}

	const id = crypto.randomUUID().replace(/-/g, '');
	const tags = data.tags && data.tags.length ? data.tags.join(',') : null;

	await db.insert(adapters).values({
		id,
		name: data.name,
		slug: finalSlug,
		description: data.description || null,
		baseModel: data.baseModel,
		modelType: data.modelType,
		rank: data.rank,
		promptTemplate: data.promptTemplate || null,
		tags,
		examples: JSON.stringify(data.examples ?? []),
		screenshots: '[]',
		iconName: data.iconName || null,
		iconColor: data.iconColor || null,
		visibility: data.visibility,
		authorId: user.id,
		status: 'draft'
	});

	return { id, slug: finalSlug };
});
