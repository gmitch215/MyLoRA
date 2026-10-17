import { desc, eq, or } from 'drizzle-orm';
import { db } from 'hub:db';
import { ngrokTokens } from 'hub:db:schema';
import { redactNgrokToken, serverNgrokToken } from '~/server/utils/ngrok-tokens';
import type { NgrokTokenList } from '~/shared/types';

// shared tokens plus the caller's own; an administrator sees every token
export default defineEventHandler(async (event): Promise<NgrokTokenList> => {
	const user = await requireCapability(event, 'canManageMachines');
	await ensureDatabase();

	const rows =
		user.role === 'administrator'
			? await db.select().from(ngrokTokens).orderBy(desc(ngrokTokens.createdAt))
			: await db
					.select()
					.from(ngrokTokens)
					.where(or(eq(ngrokTokens.shared, true), eq(ngrokTokens.ownerId, user.id)))
					.orderBy(desc(ngrokTokens.createdAt));
	return { tokens: rows.map(redactNgrokToken), serverSecret: !!serverNgrokToken() };
});
