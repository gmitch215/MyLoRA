import { eq } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { db } from 'hub:db';
import { adapters, users } from 'hub:db:schema';
import { getPermissions } from './settings';

export type SessionUser = {
	id: string;
	username: string;
	displayName: string;
	role: Role;
	avatarPathname?: string | null;
	bio?: string | null;
};

export async function getCurrentUser(event: H3Event): Promise<SessionUser | null> {
	const session = await getUserSession(event);
	return (session.user as SessionUser | undefined) ?? null;
}

export async function requireAuthed(event: H3Event): Promise<SessionUser> {
	const user = await getCurrentUser(event);
	if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
	return user;
}

export async function requireAdmin(event: H3Event): Promise<SessionUser> {
	const user = await getCurrentUser(event);
	if (!user || user.role !== 'administrator') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}
	return user;
}

// administrator or manager
export async function requireManager(event: H3Event): Promise<SessionUser> {
	const user = await requireAuthed(event);
	if (user.role !== 'administrator' && user.role !== 'manager') {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}
	return user;
}

// any active authenticated user (developer+)
export async function requireDeveloper(event: H3Event): Promise<SessionUser> {
	return requireAuthed(event);
}

// resolve a capability for a user against the settings permission matrix
export async function capabilitiesFor(role: Role): Promise<Capability> {
	const permissions = await getPermissions();
	return capabilityFor(role, permissions);
}

export async function hasCapability(
	user: SessionUser,
	capability: keyof Capability
): Promise<boolean> {
	const caps = await capabilitiesFor(user.role);
	return caps[capability];
}

export async function requireCapability(
	event: H3Event,
	capability: keyof Capability
): Promise<SessionUser> {
	const user = await requireAuthed(event);
	if (!(await hasCapability(user, capability))) {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}
	return user;
}

// gate edit/delete on an adapter using ownership + the matrix
export async function requireAdapterAccess(
	event: H3Event,
	adapterId: string,
	action: 'edit' | 'delete'
): Promise<{ user: SessionUser; authorId: string | null }> {
	const user = await requireAuthed(event);
	const rows = await db
		.select({ authorId: adapters.authorId })
		.from(adapters)
		.where(eq(adapters.id, adapterId))
		.limit(1);

	const row = rows[0];
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Adapter not found' });

	const caps = await capabilitiesFor(user.role);
	const isOwner = !!row.authorId && row.authorId === user.id;
	const allowed =
		action === 'edit'
			? caps.canEditAny || (isOwner && caps.canEditOwn)
			: caps.canDeleteAny || (isOwner && caps.canDeleteOwn);
	if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	return { user, authorId: row.authorId };
}

export async function adminCount(): Promise<number> {
	const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'administrator'));
	return rows.filter((u) => u.id).length;
}
