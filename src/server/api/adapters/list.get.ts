import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { adapters, users } from 'hub:db:schema';

const SORTS = ['newest', 'downloads', 'inference', 'name'] as const;
type Sort = (typeof SORTS)[number];

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const user = await getCurrentUser(event);

	// cache per user-scope + query on the CACHE kv namespace (anon and each user see different rows);
	// busted by invalidateAdapterLists on any adapter create/upload/update/publish/delete
	const scope = user ? `u:${user.id}` : 'anon';
	const cacheKey = adapterListKey(`${scope}:${getRequestURL(event).search || 'all'}`);

	return tryCache(
		cacheKey,
		async () => {
			const q = getQuery(event);

			const search = typeof q.q === 'string' ? q.q.trim() : '';
			const baseModel = typeof q.baseModel === 'string' ? q.baseModel.trim() : '';
			const modelType = typeof q.modelType === 'string' ? q.modelType.trim() : '';
			const tag = typeof q.tag === 'string' ? q.tag.trim() : '';
			const sort: Sort = SORTS.includes(q.sort as Sort) ? (q.sort as Sort) : 'newest';

			// `mine=1` restricts to the current user's own adapters (the dashboard uses this so its list is
			// never a filtered/paginated slice of the shared public feed)
			const mine = (q.mine === '1' || q.mine === 'true') && !!user;

			const limits = await getLimits();
			const maxPage = mine ? 200 : limits.gridPageSize;
			const pageSize = Math.min(maxPage, Math.max(1, Number(q.pageSize) || maxPage));
			const page = Math.max(1, Number(q.page) || 1);

			// anyone sees public+listed/published; a logged-in user also sees their own (never archived)
			const publicClause = and(
				eq(adapters.visibility, 'public'),
				or(
					eq(adapters.status, 'listed'),
					eq(adapters.status, 'published'),
					eq(adapters.status, 'migrated')
				)
			);
			const ownClause = user
				? and(eq(adapters.authorId, user.id), sql`${adapters.status} != 'archived'`)
				: undefined;
			// mine -> only the user's own; otherwise public (+ the user's own when logged in)
			const visibilityClause = mine
				? ownClause
				: user
					? or(publicClause, ownClause!)
					: publicClause;

			const filters = [visibilityClause];
			if (search) {
				const pat = `%${search}%`;
				filters.push(
					or(like(adapters.name, pat), like(adapters.description, pat), like(adapters.tags, pat))!
				);
			}
			if (baseModel) filters.push(eq(adapters.baseModel, baseModel));
			if (modelType) filters.push(eq(adapters.modelType, modelType as any));
			if (tag) filters.push(like(adapters.tags, `%${tag}%`));
			// optional status filter (intersected with the visibility clause above); used by the playground
			const status = typeof q.status === 'string' ? q.status.trim() : '';
			if (status && status !== 'all') filters.push(eq(adapters.status, status as any));

			const where = and(...filters);

			const orderBy =
				sort === 'downloads'
					? desc(adapters.downloadCount)
					: sort === 'inference'
						? desc(adapters.inferenceCount)
						: sort === 'name'
							? asc(adapters.name)
							: desc(adapters.createdAt);

			const totalRows = await db
				.select({ count: sql<number>`count(*)` })
				.from(adapters)
				.where(where);
			const total = Number(totalRows[0]?.count ?? 0);

			const rows = await db
				.select()
				.from(adapters)
				.leftJoin(users, eq(adapters.authorId, users.id))
				.where(where)
				.orderBy(orderBy)
				.limit(pageSize)
				.offset((page - 1) * pageSize);

			const items: Adapter[] = rows.map((r) => toAdapter(r.adapters, r.users));

			return { items, total, page, pageSize };
		},
		20
	);
});
