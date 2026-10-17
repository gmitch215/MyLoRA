import type { APIRequestContext } from '@playwright/test';
import { loginViaApi } from '../utils/auth';
import { createNgrokToken, listNgrokTokens, removeNgrokTokens } from '../utils/ngrok';
import { createUser, deleteUser, type TempUser } from '../utils/users';
import { expect, test } from './fixtures';

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

async function loginAs(playwright: any, user: TempUser): Promise<APIRequestContext> {
	const ctx = await playwright.request.newContext({ baseURL: BASE });
	const res = await ctx.post('/api/login', {
		data: { username: user.username, password: user.password }
	});
	if (!res.ok()) throw new Error(`login failed for ${user.username}: ${res.status()}`);
	return ctx;
}

test.describe('ngrok tokens api', () => {
	test('needs the manage-machines capability', async ({ request, playwright }) => {
		await loginViaApi(request);
		const dev = await createUser(request, { role: 'developer' });
		const anon = await playwright.request.newContext({ baseURL: BASE });
		expect([401, 403]).toContain((await anon.get('/api/ngrok-tokens/list')).status());
		await anon.dispose();

		const ctx = await loginAs(playwright, dev);
		expect((await ctx.get('/api/ngrok-tokens/list')).status()).toBe(403);
		const created = await ctx.post('/api/ngrok-tokens/create', {
			data: { label: 'x', token: 'abcdefghijklmnopqrstuvwxyz' }
		});
		expect(created.status()).toBe(403);
		await ctx.dispose();
		await deleteUser(request, dev.id);
	});

	test('creates a token and never returns it, only the last four characters', async ({
		request
	}) => {
		await loginViaApi(request);
		const made = await createNgrokToken(request, { label: 'Redaction' });
		expect(made.status).toBe(200);
		expect(JSON.stringify(made.res)).not.toContain(made.token);
		expect(made.res.tokenLast4).toBe(made.token.slice(-4));
		expect(made.res.tokenCipher).toBeUndefined();
		expect(made.res.dekCipher).toBeUndefined();

		const list = await request.get('/api/ngrok-tokens/list');
		expect(await list.text()).not.toContain(made.token);
		expect((await listNgrokTokens(request)).tokens.some((t) => t.id === made.id)).toBe(true);
		await removeNgrokTokens(request, [made.id]);
	});

	test('reports whether the server has its own token', async ({ request }) => {
		await loginViaApi(request);
		expect((await listNgrokTokens(request)).serverSecret).toBe(true);
	});

	test('refuses a token that is too short or has characters a config file cannot hold', async ({
		request
	}) => {
		await loginViaApi(request);
		for (const token of [
			'short',
			'abcdefghijklmnopqrstuvwxyz\nextra',
			'abcdefghijklmnopqrstuv"x'
		]) {
			const res = await request.post('/api/ngrok-tokens/create', {
				data: { label: 'Bad', token }
			});
			expect(res.status()).toBe(400);
		}
		expect(
			(
				await request.post('/api/ngrok-tokens/create', {
					data: { label: '', token: 'a'.repeat(30) }
				})
			).status()
		).toBe(400);
	});

	test('keeps one default per owner', async ({ request, playwright }) => {
		await loginViaApi(request);
		const manager = await createUser(request, { role: 'manager' });
		const other = await loginAs(playwright, manager);

		const a = await createNgrokToken(request, { label: 'Admin A', isDefault: true });
		const b = await createNgrokToken(request, { label: 'Admin B', isDefault: true });
		const m = await createNgrokToken(other, { label: 'Manager M', isDefault: true });

		await loginViaApi(request);
		const list = (await listNgrokTokens(request)).tokens;
		const flag = (id: string) => list.find((t) => t.id === id)?.isDefault;
		expect(flag(a.id)).toBe(false);
		expect(flag(b.id)).toBe(true);
		// another owner's default is untouched
		expect(flag(m.id)).toBe(true);

		const patched = await request.patch(`/api/ngrok-tokens/${a.id}`, { data: { isDefault: true } });
		expect(patched.ok()).toBe(true);
		const after = (await listNgrokTokens(request)).tokens;
		expect(after.find((t) => t.id === a.id)?.isDefault).toBe(true);
		expect(after.find((t) => t.id === b.id)?.isDefault).toBe(false);
		expect(after.find((t) => t.id === m.id)?.isDefault).toBe(true);

		await removeNgrokTokens(request, [a.id, b.id, m.id]);
		await other.dispose();
		await deleteUser(request, manager.id);
	});

	test('personal tokens stay private; shared ones are visible but only their owner changes them', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const manager = await createUser(request, { role: 'manager' });
		const other = await loginAs(playwright, manager);

		const personal = await createNgrokToken(request, { label: 'Admin Personal' });
		const shared = await createNgrokToken(request, { label: 'Admin Shared', shared: true });
		const mine = await createNgrokToken(other, { label: 'Manager Own' });

		// the manager sees the shared token and their own, not the administrator's personal one
		const seen = (await listNgrokTokens(other)).tokens.map((t) => t.id);
		expect(seen).toContain(shared.id);
		expect(seen).toContain(mine.id);
		expect(seen).not.toContain(personal.id);

		// but cannot change or delete the administrator's shared token
		expect(
			(await other.patch(`/api/ngrok-tokens/${shared.id}`, { data: { label: 'x' } })).status()
		).toBe(403);
		expect((await other.delete(`/api/ngrok-tokens/${shared.id}`)).status()).toBe(403);
		expect(
			(await other.patch(`/api/ngrok-tokens/${personal.id}`, { data: { label: 'x' } })).status()
		).toBe(403);

		// an administrator manages every token
		await loginViaApi(request);
		const renamed = await request.patch(`/api/ngrok-tokens/${mine.id}`, {
			data: { label: 'Renamed By Admin' }
		});
		expect(renamed.ok()).toBe(true);
		expect((await renamed.json()).label).toBe('Renamed By Admin');
		expect((await request.delete(`/api/ngrok-tokens/${mine.id}`)).ok()).toBe(true);

		await removeNgrokTokens(request, [personal.id, shared.id]);
		await other.dispose();
		await deleteUser(request, manager.id);
	});

	test('rotating a token updates the last four, and a blank token keeps the stored one', async ({
		request
	}) => {
		await loginViaApi(request);
		const made = await createNgrokToken(request, { label: 'Rotate' });
		const next = `${made.token.slice(0, -4)}ZZZZ`;

		const kept = await request.patch(`/api/ngrok-tokens/${made.id}`, { data: { token: '' } });
		expect((await kept.json()).tokenLast4).toBe(made.token.slice(-4));

		const rotated = await request.patch(`/api/ngrok-tokens/${made.id}`, { data: { token: next } });
		const body = await rotated.json();
		expect(body.tokenLast4).toBe('ZZZZ');
		expect(JSON.stringify(body)).not.toContain(next);

		expect(
			(await request.patch(`/api/ngrok-tokens/${made.id}`, { data: { token: 'short' } })).status()
		).toBe(400);
		await removeNgrokTokens(request, [made.id]);
	});

	test('404s for a token that does not exist', async ({ request }) => {
		await loginViaApi(request);
		expect(
			(
				await request.patch(`/api/ngrok-tokens/${'0'.repeat(32)}`, { data: { label: 'x' } })
			).status()
		).toBe(404);
		expect((await request.delete(`/api/ngrok-tokens/${'0'.repeat(32)}`)).status()).toBe(404);
	});
});
