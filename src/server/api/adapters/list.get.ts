import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { adapters, users } from 'hub:db:schema';

const SORTS = ['newest', 'downloads', 'inference', 'name'] as const;
type Sort = (typeof SORTS)[number];

// the public feed is cached briefly; authed users (who can see their own drafts) bypass the cache
export default defineCachedEventHandler(
	async (event) => {
		await ensureDatabase();
		const user = await getCurrentUser(event);
		const q = getQuery(event);

		const search = typeof q.q === 'string' ? q.q.trim() : '';
		const baseModel = typeof q.baseModel === 'string' ? q.baseModel.trim() : '';
		const modelType = typeof q.modelType === 'string' ? q.modelType.trim() : '';
		const tag = typeof q.tag === 'string' ? q.tag.trim() : '';
		const sort: Sort = SORTS.includes(q.sort as Sort) ? (q.sort as Sort) : 'newest';

		const limits = await getLimits();
		const pageSize = Math.min(
			limits.gridPageSize,
			Math.max(1, Number(q.pageSize) || limits.gridPageSize)
		);
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
		const visibilityClause = user
			? or(publicClause, and(eq(adapters.authorId, user.id), sql`${adapters.status} != 'archived'`))
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
	{
		maxAge: 30,
		name: 'adapters-list',
		getKey: (event) => getRequestURL(event).search || 'all',
		// never cache per-user views (logged-in users see their own drafts)
		shouldBypassCache: (event) => !!getCookie(event, 'nuxt-session')
	}
);
