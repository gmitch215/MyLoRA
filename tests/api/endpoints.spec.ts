import type { APIRequestContext } from '@playwright/test';
import { createAdapter, uploadAssets } from '../utils/adapters';
import { loginViaApi } from '../utils/auth';
import { createNgrokToken, removeNgrokTokens } from '../utils/ngrok';
import { createUser, deleteUser, type TempUser } from '../utils/users';
import { expect, test } from './fixtures';

// dev:test runs with MYLORA_MOCK_CF=1, so endpoint calls and the vLLM serve job use the in-memory
// simulation keyed off the hostname: mock-auth.* answers 401, mock-down.* is unreachable, and a
// machine host starting with mock-fail makes the server fail to start.

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8787';

async function loginAs(playwright: any, user: TempUser): Promise<APIRequestContext> {
	const ctx = await playwright.request.newContext({ baseURL: BASE });
	const res = await ctx.post('/api/login', {
		data: { username: user.username, password: user.password }
	});
	if (!res.ok()) throw new Error(`login failed for ${user.username}: ${res.status()}`);
	return ctx;
}

let seq = 0;
const uniqueHost = (prefix = 'vllm') => `${prefix}-${Date.now()}-${seq++}.mock.test`;

async function createEndpoint(request: APIRequestContext, over: Record<string, unknown> = {}) {
	const res = await request.post('/api/endpoints/create', {
		data: {
			label: `Endpoint ${seq++}`,
			baseUrl: `https://${uniqueHost()}/v1`,
			defaultModel: 'base-model',
			apiKey: 'sk-test-key-abcd1234',
			shared: true,
			...over
		}
	});
	return res;
}

async function bind(request: APIRequestContext, adapterId: string, endpointId: string | null) {
	return request.patch('/api/adapters/update', {
		data: { id: adapterId, endpointId, endpointModel: endpointId ? 'my-lora' : null }
	});
}

async function widget(request: APIRequestContext, adapterId: string, prompt = 'hello') {
	return request.post('/api/infer/widget', { data: { adapterId, prompt } });
}

// the stream is one frame per word; this is the text a reader would see
async function streamText(res: { text(): Promise<string> }): Promise<string> {
	return (await res.text())
		.split('\n\n')
		.map((f) => f.replace(/^data: /, ''))
		.filter((f) => f && f !== '[DONE]')
		.map((f) => (JSON.parse(f) as { response?: string }).response ?? '')
		.join('');
}

test.describe('endpoints api', () => {
	test('needs the manage-machines capability', async ({ request, playwright }) => {
		await loginViaApi(request);
		const dev = await createUser(request, { role: 'developer' });
		const anon = await playwright.request.newContext({ baseURL: BASE });
		expect([401, 403]).toContain((await anon.get('/api/endpoints/list')).status());
		await anon.dispose();

		const ctx = await loginAs(playwright, dev);
		expect((await ctx.get('/api/endpoints/list')).status()).toBe(403);
		expect((await ctx.post('/api/endpoints/create', { data: {} })).status()).toBe(403);
		await ctx.dispose();
		await deleteUser(request, dev.id);
	});

	test('creates an endpoint and never returns the key', async ({ request }) => {
		await loginViaApi(request);
		const res = await createEndpoint(request, { label: 'Home Box' });
		expect(res.ok()).toBe(true);
		const text = await res.text();
		expect(text).not.toContain('sk-test-key-abcd1234');
		const ep = JSON.parse(text);
		expect(ep).toMatchObject({
			label: 'Home Box',
			source: 'external',
			keyLast4: '1234',
			shared: true
		});

		const list = await (await request.get('/api/endpoints/list')).text();
		expect(list).not.toContain('sk-test-key-abcd1234');
		expect(list).not.toContain('keyCipher');
		await request.delete(`/api/endpoints/${ep.id}`);
	});

	test('refuses urls that could reach inside', async ({ request }) => {
		await loginViaApi(request);
		for (const baseUrl of [
			'http://vllm.mock.test/v1',
			'https://127.0.0.1/v1',
			'https://169.254.169.254/latest',
			'https://localhost/v1',
			'https://db.internal/v1',
			'https://user:pw@vllm.mock.test/v1',
			'https://vllm.mock.test:22/v1',
			'https://thing.workers.dev/v1'
		]) {
			const res = await createEndpoint(request, { baseUrl });
			expect(res.status(), baseUrl).toBe(400);
		}
	});

	test('tests an endpoint and records the result', async ({ request }) => {
		await loginViaApi(request);
		const ok = await (await createEndpoint(request)).json();
		const good = await (await request.post(`/api/endpoints/${ok.id}/test`)).json();
		expect(good.endpoint.health).toBe('ok');
		expect(good.models.length).toBeGreaterThan(0);

		const auth = await (
			await createEndpoint(request, { baseUrl: 'https://mock-auth.example.test/v1' })
		).json();
		expect(
			(await (await request.post(`/api/endpoints/${auth.id}/test`)).json()).endpoint.health
		).toBe('auth_failed');

		const down = await (
			await createEndpoint(request, { baseUrl: 'https://mock-down.example.test/v1' })
		).json();
		expect(
			(await (await request.post(`/api/endpoints/${down.id}/test`)).json()).endpoint.health
		).toBe('unreachable');

		for (const e of [ok, auth, down]) await request.delete(`/api/endpoints/${e.id}`);
	});

	test('a blank key keeps the stored one and a new url resets the health', async ({ request }) => {
		await loginViaApi(request);
		const ep = await (await createEndpoint(request)).json();
		await request.post(`/api/endpoints/${ep.id}/test`);

		const keep = await (
			await request.patch(`/api/endpoints/${ep.id}`, { data: { label: 'Renamed', apiKey: '' } })
		).json();
		expect(keep.label).toBe('Renamed');
		expect(keep.keyLast4).toBe('1234');
		expect(keep.health).toBe('ok');

		const moved = await (
			await request.patch(`/api/endpoints/${ep.id}`, {
				data: { baseUrl: `https://${uniqueHost('moved')}/v1/` }
			})
		).json();
		expect(moved.health).toBe('unchecked');
		expect(moved.baseUrl.endsWith('/v1')).toBe(true);

		expect(
			(
				await request.patch(`/api/endpoints/${ep.id}`, { data: { baseUrl: 'http://x.test' } })
			).status()
		).toBe(400);
		await request.delete(`/api/endpoints/${ep.id}`);
	});

	test('personal endpoints are visible to their owner and administrators only', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const manager = await createUser(request, { role: 'manager' });
		const other = await createUser(request, { role: 'manager' });
		const ctx = await loginAs(playwright, manager);
		const otherCtx = await loginAs(playwright, other);

		const mine = await (await createEndpoint(ctx, { shared: false, label: 'Mine' })).json();
		const shared = await (await createEndpoint(ctx, { shared: true, label: 'Shared' })).json();

		const seenByOther = (await (await otherCtx.get('/api/endpoints/list')).json()) as {
			id: string;
		}[];
		expect(seenByOther.map((e) => e.id)).toContain(shared.id);
		expect(seenByOther.map((e) => e.id)).not.toContain(mine.id);
		expect(
			(await otherCtx.patch(`/api/endpoints/${shared.id}`, { data: { label: 'x' } })).status()
		).toBe(403);
		expect((await otherCtx.delete(`/api/endpoints/${mine.id}`)).status()).toBe(403);

		const seenByAdmin = (await (await request.get('/api/endpoints/list')).json()) as {
			id: string;
		}[];
		expect(seenByAdmin.map((e) => e.id)).toEqual(expect.arrayContaining([mine.id, shared.id]));

		await ctx.dispose();
		await otherCtx.dispose();
		await request.delete(`/api/endpoints/${mine.id}`);
		await request.delete(`/api/endpoints/${shared.id}`);
		await deleteUser(request, manager.id);
		await deleteUser(request, other.id);
	});
});

test.describe('adapters served from an endpoint', () => {
	test('binding needs the capability and a real endpoint, and clears cleanly', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const ep = await (await createEndpoint(request)).json();
		const adapter = await createAdapter(request);

		expect((await bind(request, adapter.id, 'nope')).status()).toBe(400);
		const bound = await (await bind(request, adapter.id, ep.id)).json();
		expect(bound).toMatchObject({ endpointId: ep.id, endpointModel: 'my-lora' });

		// a developer can edit their own adapter's metadata but cannot point it at an endpoint
		const dev = await createUser(request, { role: 'developer' });
		const ctx = await loginAs(playwright, dev);
		const own = await (
			await ctx.post('/api/adapters/create', {
				data: {
					name: 'dev adapter',
					slug: `dev-${Date.now()}`,
					baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
					modelType: 'mistral',
					rank: 8,
					tags: [],
					examples: [],
					visibility: 'public'
				}
			})
		).json();
		expect((await bind(ctx, own.id, ep.id)).status()).toBe(403);
		expect(
			(await ctx.patch('/api/adapters/update', { data: { id: own.id, name: 'renamed' } })).ok()
		).toBe(true);
		await ctx.dispose();

		const cleared = await (await bind(request, adapter.id, null)).json();
		expect(cleared.endpointId).toBeNull();
		await request.delete(`/api/endpoints/${ep.id}`);
		await deleteUser(request, dev.id);
	});

	test("a manager cannot attach an adapter to another user's personal endpoint", async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const owner = await createUser(request, { role: 'manager' });
		const other = await createUser(request, { role: 'manager' });
		const ownerCtx = await loginAs(playwright, owner);
		const otherCtx = await loginAs(playwright, other);

		const personal = await (await createEndpoint(ownerCtx, { shared: false })).json();
		const shared = await (await createEndpoint(ownerCtx, { shared: true })).json();
		// created through the manager's own session: the shared helper would sign it in as admin
		const adapter = await (
			await otherCtx.post('/api/adapters/create', {
				data: {
					name: 'manager adapter',
					slug: `mgr-${Date.now()}`,
					baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
					modelType: 'mistral',
					rank: 8,
					tags: [],
					examples: [],
					visibility: 'public'
				}
			})
		).json();

		// same answer as for an id that does not exist, so it does not confirm the endpoint is there
		const denied = await bind(otherCtx, adapter.id, personal.id);
		const missing = await bind(otherCtx, adapter.id, 'f'.repeat(32));
		expect(denied.status()).toBe(400);
		expect(await denied.text()).toBe(await missing.text());
		expect((await bind(otherCtx, adapter.id, shared.id)).ok()).toBe(true);

		// the owner and an administrator can still use it
		expect((await bind(request, adapter.id, personal.id)).ok()).toBe(true);

		await ownerCtx.dispose();
		await otherCtx.dispose();
		await bind(request, adapter.id, null);
		await request.delete(`/api/endpoints/${personal.id}`);
		await request.delete(`/api/endpoints/${shared.id}`);
		await deleteUser(request, owner.id);
		await deleteUser(request, other.id);
	});

	test('a listed adapter on an endpoint answers in the widget, and one without does not', async ({
		request
	}) => {
		await loginViaApi(request);
		const ep = await (await createEndpoint(request)).json();
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);

		// listed and on Cloudflare only: not testable yet
		expect((await widget(request, adapter.id)).status()).toBe(409);

		await bind(request, adapter.id, ep.id);
		const res = await widget(request, adapter.id, 'ping');
		expect(res.ok()).toBe(true);
		expect(await streamText(res)).toBe('[mock endpoint:my-lora] ping');

		// a deleted endpoint hands the adapter back to Workers AI
		await request.delete(`/api/endpoints/${ep.id}`);
		const after = await (await request.get(`/api/adapters/find?slug=${adapter.slug}`)).json();
		expect(after.endpointId).toBeNull();
		expect((await widget(request, adapter.id)).status()).toBe(409);
	});

	test('a private endpoint answers its owner and refuses other users', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const dev = await createUser(request, { role: 'developer' });
		const ctx = await loginAs(playwright, dev);

		const personal = await (await createEndpoint(request, { shared: false })).json();
		const shared = await (await createEndpoint(request, { shared: true })).json();
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);

		await bind(request, adapter.id, personal.id);
		expect((await widget(request, adapter.id)).ok()).toBe(true);
		const denied = await widget(ctx, adapter.id);
		expect(denied.status()).toBe(403);
		expect(await denied.text()).toMatch(/private endpoint/i);

		await bind(request, adapter.id, shared.id);
		const allowed = await widget(ctx, adapter.id);
		expect(allowed.ok()).toBe(true);
		expect(await streamText(allowed)).toContain('[mock endpoint:my-lora]');

		await ctx.dispose();
		await request.delete(`/api/endpoints/${personal.id}`);
		await request.delete(`/api/endpoints/${shared.id}`);
		await deleteUser(request, dev.id);
	});

	test('an inactive endpoint is not called', async ({ request }) => {
		await loginViaApi(request);
		const ep = await (await createEndpoint(request)).json();
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);
		await bind(request, adapter.id, ep.id);
		await request.patch(`/api/endpoints/${ep.id}`, { data: { isActive: false } });
		expect((await widget(request, adapter.id)).status()).toBe(409);
		await request.delete(`/api/endpoints/${ep.id}`);
	});
});

async function createMachine(request: APIRequestContext, host: string) {
	const res = await request.post('/api/machines/create', {
		data: {
			label: `Serve ${host}`,
			host,
			port: 22,
			username: 'trainer',
			connectionType: 'vps',
			shared: true,
			authMethod: 'key',
			keySource: 'generated'
		}
	});
	if (!res.ok()) throw new Error(`create machine failed: ${res.status()} ${await res.text()}`);
	return (await res.json()).machine as { id: string };
}

// the curated base maps to a HuggingFace repo, and an adapter trained on it can join a server
const HF_BASE = 'mistralai/Mistral-7B-Instruct-v0.2';

async function serve(
	request: APIRequestContext,
	machineId: string,
	adapterIds: string[],
	over = {}
) {
	return request.post('/api/endpoints/serve', {
		data: {
			label: 'vLLM test',
			machineId,
			baseModel: HF_BASE,
			adapterIds,
			port: 8000,
			maxLoraRank: 32,
			tunnel: 'ngrok',
			...over
		}
	});
}

async function pollUntil(request: APIRequestContext, id: string, done: (s: string) => boolean) {
	let ep: any = null;
	for (let i = 0; i < 8; i++) {
		ep = await (await request.post(`/api/endpoints/${id}/poll`)).json();
		if (done(ep.serveStatus)) break;
	}
	return ep;
}

test.describe('vllm serve job', () => {
	test('starts, becomes ready with a tunnel url, serves an adapter, and stops', async ({
		request
	}) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-ok.serve');
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);

		const started = await serve(request, machine.id, [adapter.id], { shared: true });
		expect(started.ok()).toBe(true);
		const first = await started.json();
		expect(first.source).toBe('vllm');
		expect(first.serve.adapters).toEqual([{ adapterId: adapter.id, name: adapter.slug }]);
		expect(JSON.stringify(first)).not.toMatch(/mylora_|secrets|keyCipher/);

		const ready = await pollUntil(request, first.id, (s) => s === 'ready');
		expect(ready.serveStatus).toBe('ready');
		expect(ready.baseUrl).toMatch(/^https:\/\/mock-vllm-[a-f0-9]{8}\.example\.test\/v1$/);
		expect(ready.health).toBe('ok');
		expect(ready.keyLast4).toHaveLength(4);

		await bind(request, adapter.id, first.id);
		const res = await widget(request, adapter.id, 'via vllm');
		expect(res.ok()).toBe(true);
		expect(await streamText(res)).toBe('[mock endpoint:my-lora] via vllm');

		const stopped = await (await request.post(`/api/endpoints/${first.id}/stop`)).json();
		expect(stopped.serveStatus).toBe('stopped');
		expect(stopped.baseUrl).toBe('');
		// a stopped server is not called
		expect((await widget(request, adapter.id)).status()).toBe(503);

		await request.delete(`/api/endpoints/${first.id}`);
	});

	test('a machine whose server dies ends failed with the reason', async ({ request }) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-fail.serve');
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);

		const first = await (await serve(request, machine.id, [adapter.id])).json();
		const done = await pollUntil(request, first.id, (s) => s === 'failed');
		expect(done.serveStatus).toBe('failed');
		expect(done.logTail).toMatch(/vllm exited before it was ready/);
		expect(done.baseUrl).toBe('');
		await request.delete(`/api/endpoints/${first.id}`);
	});

	test('checks the adapters before it queues anything', async ({ request }) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-ok.serve-checks');

		// no uploaded files
		const empty = await createAdapter(request);
		const noFiles = await serve(request, machine.id, [empty.id]);
		expect(noFiles.status()).toBe(400);
		expect(await noFiles.text()).toMatch(/no uploaded files/);

		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);
		// trained on another base
		const wrongBase = await serve(request, machine.id, [adapter.id], {
			baseModel: 'meta-llama/Llama-3.1-8B-Instruct'
		});
		expect(wrongBase.status()).toBe(400);
		expect(await wrongBase.text()).toMatch(/was trained on/);
		// rank above the server's ceiling
		const tooBig = await serve(request, machine.id, [adapter.id], { maxLoraRank: 4 });
		expect(tooBig.status()).toBe(400);
		expect(await tooBig.text()).toMatch(/rank/);
		// unknown adapter
		expect((await serve(request, machine.id, ['0'.repeat(32)])).status()).toBe(400);
		// named cloudflared tunnel without a hostname
		const noHost = await serve(request, machine.id, [adapter.id], {
			tunnel: 'cloudflared',
			tunnelToken: 'tok'
		});
		expect(noHost.status()).toBe(400);
		expect(await noHost.text()).toMatch(/hostname/);
	});

	test('deleting a running server stops it and unbinds its adapters', async ({ request }) => {
		await loginViaApi(request);
		const machine = await createMachine(request, 'mock-ok.serve-delete');
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);

		const first = await (await serve(request, machine.id, [adapter.id])).json();
		await pollUntil(request, first.id, (s) => s === 'ready');
		await bind(request, adapter.id, first.id);

		expect((await request.delete(`/api/endpoints/${first.id}`)).ok()).toBe(true);
		const after = await (await request.get(`/api/adapters/find?slug=${adapter.slug}`)).json();
		expect(after.endpointId).toBeNull();
		expect((await request.get(`/api/endpoints/${first.id}`)).status()).toBe(404);
	});
});

test.describe('vllm serve adapter scope', () => {
	test('a user without edit-any can serve public and own adapters, not another user private one', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const matrix = (canManageMachines: boolean) => ({
			developer: {
				canCreate: true,
				canEditOwn: true,
				canEditAny: false,
				canDeleteOwn: false,
				canDeleteAny: false,
				canPublish: false,
				canManageAccounts: false,
				canManageMachines,
				canTrain: true,
				unlimitedTester: false
			},
			manager: {
				canCreate: true,
				canEditOwn: true,
				canEditAny: true,
				canDeleteOwn: false,
				canDeleteAny: false,
				canPublish: true,
				canManageAccounts: true,
				canManageMachines: true,
				canTrain: true,
				unlimitedTester: true
			}
		});
		await request.post('/api/settings', { data: { permissions: matrix(true) } });
		const dev = await createUser(request, { role: 'developer' });
		const ctx = await loginAs(playwright, dev);
		const machine = await createMachine(request, 'mock-ok.serve-scope');
		const publicOne = await createAdapter(request, { visibility: 'public' });
		const privateOne = await createAdapter(request, { visibility: 'private' });
		await uploadAssets(request, publicOne.id);
		await uploadAssets(request, privateOne.id);

		const denied = await serve(ctx, machine.id, [privateOne.id]);
		expect(denied.status()).toBe(400);
		expect(await denied.text()).toMatch(/does not exist/);
		// the same answer as an id that is not there, so a private adapter is not revealed
		const missing = await serve(ctx, machine.id, ['0'.repeat(32)]);
		expect(await missing.text()).toBe(await denied.text());

		const allowed = await serve(ctx, machine.id, [publicOne.id]);
		expect(allowed.ok()).toBe(true);
		const made = [(await allowed.json()).id as string];

		const own = await ctx.post('/api/adapters/create', {
			data: {
				name: `dev-own-${Date.now()}`,
				slug: `dev-own-${Date.now()}`,
				description: 'mine',
				baseModel: '@cf/mistral/mistral-7b-instruct-v0.2-lora',
				modelType: 'mistral',
				rank: 8,
				tags: ['test'],
				examples: [],
				visibility: 'private'
			}
		});
		const ownId = (await own.json()).id as string;
		await uploadAssets(ctx, ownId);
		const ownServe = await serve(ctx, machine.id, [ownId]);
		expect(ownServe.ok()).toBe(true);
		made.push((await ownServe.json()).id);

		await loginViaApi(request);
		for (const id of made) await request.delete(`/api/endpoints/${id}`);
		await request.post('/api/settings', { data: { permissions: matrix(false) } });
		await ctx.dispose();
		await deleteUser(request, dev.id);
	});
});

test.describe('vllm serve ngrok token source', () => {
	async function started(
		request: APIRequestContext,
		over: Record<string, unknown>,
		host = `mock-ok.${uniqueHost('ngrok')}`
	) {
		const machine = await createMachine(request, host);
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);
		return serve(request, machine.id, [adapter.id], over);
	}

	test('starts with each source and records the choice without any secret', async ({ request }) => {
		await loginViaApi(request);
		const token = await createNgrokToken(request, { label: 'Serve Token' });
		const made: string[] = [];
		for (const source of ['auto', 'machine', 'server', token.id]) {
			const res = await started(request, { ngrokToken: source });
			expect(res.ok(), `source ${source}`).toBe(true);
			const ep = await res.json();
			made.push(ep.id);
			expect(ep.serve.ngrokToken).toBe(source);
			// provisioning resolved the token without failing the job
			expect(ep.serveStatus).not.toBe('failed');
			expect(JSON.stringify(ep)).not.toContain(token.token);
		}
		for (const id of made) await request.delete(`/api/endpoints/${id}`);
		await removeNgrokTokens(request, [token.id]);
	});

	test('defaults to the automatic choice', async ({ request }) => {
		await loginViaApi(request);
		const res = await started(request, {});
		expect(res.ok()).toBe(true);
		const ep = await res.json();
		expect(ep.serve.ngrokToken).toBe('auto');
		await request.delete(`/api/endpoints/${ep.id}`);
	});

	test('refuses a token that does not exist, is inactive, or belongs to someone else', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const unknown = await started(request, { ngrokToken: '0'.repeat(32) });
		expect(unknown.status()).toBe(400);
		expect(await unknown.text()).toMatch(/ngrok token is not available/);

		const off = await createNgrokToken(request, { label: 'Inactive' });
		await request.patch(`/api/ngrok-tokens/${off.id}`, { data: { isActive: false } });
		expect((await started(request, { ngrokToken: off.id })).status()).toBe(400);

		const manager = await createUser(request, { role: 'manager' });
		const other = await loginAs(playwright, manager);
		const theirs = await createNgrokToken(other, { label: 'Theirs' });
		await loginViaApi(request);
		// an administrator may manage it but still cannot run a serve with a personal token of another user
		expect((await started(request, { ngrokToken: theirs.id })).status()).toBe(400);

		await removeNgrokTokens(request, [off.id, theirs.id]);
		await other.dispose();
		await deleteUser(request, manager.id);
	});

	test('lets a user run a serve with a shared token another user made', async ({
		request,
		playwright
	}) => {
		await loginViaApi(request);
		const shared = await createNgrokToken(request, { label: 'Shared For All', shared: true });
		const manager = await createUser(request, { role: 'manager' });
		const other = await loginAs(playwright, manager);

		const machine = await createMachine(other, `mock-ok.${uniqueHost('shared-token')}`);
		const adapter = await createAdapter(request);
		await uploadAssets(request, adapter.id);
		const res = await serve(other, machine.id, [adapter.id], { ngrokToken: shared.id });
		expect(res.ok()).toBe(true);
		const ep = await res.json();

		await loginViaApi(request);
		await request.delete(`/api/endpoints/${ep.id}`);
		await removeNgrokTokens(request, [shared.id]);
		await other.dispose();
		await deleteUser(request, manager.id);
	});

	test('a cloudflared tunnel does not carry an ngrok choice', async ({ request }) => {
		await loginViaApi(request);
		const res = await started(request, { tunnel: 'cloudflared', ngrokToken: 'server' });
		expect(res.ok()).toBe(true);
		const ep = await res.json();
		expect(ep.serve.ngrokToken).toBeUndefined();
		await request.delete(`/api/endpoints/${ep.id}`);
	});
});
