import { sql } from 'drizzle-orm';
import { db } from 'hub:db';

const SETUP_COOKIE_OPTS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

// mark setup done everywhere a request can prove an admin exists: kv flag (server truth) + a cookie
// (instant read-your-writes for this browser), so a refresh never bounces back to /setup while d1's
// read replica / kv edge are still catching up after the insert
async function sealSetup(event: Parameters<typeof setCookie>[0]) {
	await markSetupCompleted();
	setCookie(event, SETUP_COOKIE, '1', SETUP_COOKIE_OPTS);
}

export default defineEventHandler(async (event) => {
	await ensureDatabase();

	const count = await userCount();
	if (count > 0) {
		await sealSetup(event);
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
	let created = false;
	try {
		const res = await db.run(sql`
			INSERT INTO users (id, username, display_name, password_hash, role, bio, avatar_pathname, is_active, created_at, updated_at)
			SELECT ${id}, ${username}, ${parsed.data.displayName}, ${hash}, ${'administrator'}, ${bio}, ${null}, ${1}, ${now}, ${now}
			WHERE NOT EXISTS (SELECT 1 FROM users)
		`);
		// trust the write's own affected-row count (read-your-writes safe); only fall back to a lookup
		// when the driver does not report it. a bare post-insert read can hit a lagging d1 replica and
		// wrongly report the row missing -> the old false 409 that stranded first-run setup
		const changes = Number((res as any)?.meta?.changes ?? (res as any)?.rowsAffected ?? NaN);
		if (Number.isFinite(changes)) {
			created = changes >= 1;
		} else {
			const check = await db.run(sql`SELECT id FROM users WHERE id = ${id} LIMIT 1`);
			created = !!check.rows?.[0];
		}
	} catch (error: any) {
		const reason = describeDbError(error);
		console.error('setup INSERT failed:', reason, error);
		if (/UNIQUE.*username/i.test(reason)) {
			throw createError({ statusCode: 409, statusMessage: 'Username already taken' });
		}
		throw createError({ statusCode: 500, statusMessage: `Setup failed: ${reason}` });
	}

	// the atomic guard blocked the insert -> an admin already exists (lost race or pre-seeded); seal
	// setup so the client stops looping, then report it
	if (!created) {
		await sealSetup(event);
		throw createError({ statusCode: 409, statusMessage: 'Setup has already been completed' });
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

	await sealSetup(event);

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
