import { and, eq, ne } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, users } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const body = await readBody(event);
	const parsed = adapterUpdateSchema.safeParse(body);
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid adapter data')
		});
	}
	const { id, ...data } = parsed.data;
	await requireAdapterAccess(event, id, 'edit');

	const current = (
		await db
			.select({
				status: adapters.status,
				baseModel: adapters.baseModel,
				modelType: adapters.modelType,
				rank: adapters.rank
			})
			.from(adapters)
			.where(eq(adapters.id, id))
			.limit(1)
	)[0];
	if (!current) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	const locked = current.status === 'pushing' || current.status === 'published';
	const changesModel =
		(data.baseModel !== undefined &&
			data.baseModel !== '' &&
			data.baseModel !== current.baseModel) ||
		(data.modelType !== undefined && data.modelType !== current.modelType) ||
		(data.rank !== undefined && data.rank !== current.rank);
	if (locked && changesModel) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Base model, model type, and rank cannot change after publishing'
		});
	}

	// metadata only; never touch files, finetune ids, account, or status here
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (data.name !== undefined) patch.name = data.name;
	if (data.description !== undefined) patch.description = data.description || null;
	if (data.baseModel !== undefined) patch.baseModel = data.baseModel;
	if (data.modelType !== undefined) patch.modelType = data.modelType;
	if (data.rank !== undefined) patch.rank = data.rank;
	if (data.promptTemplate !== undefined) patch.promptTemplate = data.promptTemplate || null;
	if (data.tags !== undefined) patch.tags = data.tags.length ? data.tags.join(',') : null;
	if (data.examples !== undefined) patch.examples = JSON.stringify(data.examples);
	if (data.iconName !== undefined) patch.iconName = data.iconName || null;
	if (data.iconColor !== undefined) patch.iconColor = data.iconColor || null;
	if (data.visibility !== undefined) patch.visibility = data.visibility;

	// keep slug globally unique if it changed
	if (data.slug !== undefined) {
		const clash = await db
			.select({ id: adapters.id })
			.from(adapters)
			.where(and(eq(adapters.slug, data.slug), ne(adapters.id, id)))
			.limit(1);
		if (clash.length) {
			throw createError({ statusCode: 409, statusMessage: 'Slug already in use' });
		}
		patch.slug = data.slug;
	}

	await db.update(adapters).set(patch).where(eq(adapters.id, id));

	const rows = await db
		.select()
		.from(adapters)
		.leftJoin(users, eq(adapters.authorId, users.id))
		.where(eq(adapters.id, id))
		.limit(1);
	const row = rows[0];
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });
	return toAdapter(row.adapters, row.users);
});
