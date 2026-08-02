import { and, desc, eq, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { adapters, users } from 'hub:db:schema';

const FEED_LIMIT = 50;
const FEED_TTL = 300;

// GET /feed.xml
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const config = useRuntimeConfig(event);
	const siteUrl = config.public.site_url?.replace(/\/+$/, '') || getRequestURL(event).origin;

	const xml = await tryCache(
		FEED_CACHE_KEY,
		async () => {
			// the anonymous visibility predicate from adapters/list.get.ts; unlisted is reachable by
			// direct slug but must never be advertised in a feed
			const rows = await db
				.select()
				.from(adapters)
				.leftJoin(users, eq(adapters.authorId, users.id))
				.where(
					and(
						eq(adapters.visibility, 'public'),
						or(
							eq(adapters.status, 'listed'),
							eq(adapters.status, 'published'),
							eq(adapters.status, 'migrated')
						)
					)
				)
				.orderBy(desc(adapters.createdAt))
				.limit(FEED_LIMIT);

			const [name, description, author, supportEmail] = await Promise.all([
				getStringSetting('name'),
				getStringSetting('description'),
				getStringSetting('author'),
				getStringSetting('supportEmail')
			]);

			return buildAtomFeed({
				siteUrl,
				name: name || config.public.name,
				description: description || config.public.description,
				author: author || config.public.author,
				supportEmail: supportEmail || config.public.supportEmail || undefined,
				adapters: rows.map((r) => toAdapter(r.adapters, r.users))
			});
		},
		FEED_TTL
	);

	setHeader(event, 'Content-Type', 'application/atom+xml; charset=utf-8');
	setHeader(event, 'Cache-Control', `public, max-age=${FEED_TTL}`);
	setHeader(event, 'Content-Length', String(feedByteLength(xml)));
	return xml;
});
