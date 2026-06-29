import { sql } from 'drizzle-orm';
import { db } from 'hub:db';

export default defineEventHandler(async (event) => {
	await ensureDatabase();

	const count = await userCount();
	if (count > 0) {
		throw createError({ statusCode: 409, statusMessage: 'Setup has already been completed' });
	}

	const body = await readBody(event);
	const parsed = userCreateSchema.safeParse({ ...body, role: 'administrator' });
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid setup data'),
			data: { issues: parsed.error.issues }
		});
	}

	const username = parsed.data.username;
	if (RESERVED_USERNAMES.has(username) && username !== 'admin') {
		throw createError({
			statusCode: 400,
			statusMessage: `"${username}" is reserved - pick a different username`
		});
	}

	// optional onboarding settings: rate limits + publish permission + access
	const rawSettings = (body as { settings?: unknown })?.settings;
	let onboardSettings: ReturnType<typeof settingsSchema.parse> | null = null;
	if (rawSettings && typeof rawSettings === 'object') {
		const s = settingsSchema.safeParse(rawSettings);
		if (!s.success) {
			throw createError({
				statusCode: 400,
				statusMessage: firstZodIssueMessage(s.error.issues, 'Invalid setup settings'),
				data: { issues: s.error.issues }
			});
		}
		onboardSettings = s.data;
	}

	const id = crypto.randomUUID().replace(/-/g, '');
	const hash = await hashPassword(parsed.data.password);
	const bio = parsed.data.bio || null;
	const now = Date.now();
	try {
		await db.run(sql`
			INSERT INTO users (id, username, display_name, password_hash, role, bio, avatar_pathname, is_active, created_at, updated_at)
			SELECT ${id}, ${username}, ${parsed.data.displayName}, ${hash}, ${'administrator'}, ${bio}, ${null}, ${1}, ${now}, ${now}
			WHERE NOT EXISTS (SELECT 1 FROM users)
		`);
		const check = await db.run(sql`SELECT id FROM users WHERE id = ${id} LIMIT 1`);
		if (!check.rows?.[0]) {
			throw createError({ statusCode: 409, statusMessage: 'Setup has already been completed' });
		}
	} catch (error: any) {
		if (error?.statusCode === 409) throw error;
		const reason = describeDbError(error);
		console.error('setup INSERT failed:', reason, error);
		if (/UNIQUE.*username/i.test(reason)) {
			throw createError({ statusCode: 409, statusMessage: 'Username already taken' });
		}
		throw createError({ statusCode: 500, statusMessage: `Setup failed: ${reason}` });
	}

	// persist optional onboarding settings (rate limits, permissions, access)
	if (onboardSettings) {
		if (onboardSettings.rateLimits !== undefined)
			await setJsonSetting('rateLimits', onboardSettings.rateLimits);
		if (onboardSettings.permissions !== undefined)
			await setJsonSetting('permissions', onboardSettings.permissions);
		if (onboardSettings.access !== undefined)
			await setJsonSetting('access', onboardSettings.access);
	}

	// short-circuits the D1 read-replica window on subsequent /api/setup/status calls
	await markSetupCompleted();

	try {
		await setUserSession(event, {
			user: {
				id,
				username,
				displayName: parsed.data.displayName,
				role: 'administrator',
				avatarPathname: null,
				bio
			},
			loggedInAt: now
		});
	} catch (error) {
		console.warn('setup auto-login skipped:', describeDbError(error));
	}

	return { ok: true, id };
});
