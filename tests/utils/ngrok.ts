import type { APIRequestContext } from '@playwright/test';

let counter = 0;

export function uniqueNgrokToken(): string {
	counter++;
	return `ngrok_${Date.now()}_${counter}_abcdefghijklmnop`;
}

export type CreatedToken = { id: string; label: string; token: string; res: any };

export async function createNgrokToken(
	request: APIRequestContext,
	over: Record<string, unknown> = {}
): Promise<CreatedToken & { status: number }> {
	const token = (over.token as string) ?? uniqueNgrokToken();
	const label = (over.label as string) ?? `Token ${counter}`;
	const res = await request.post('/api/ngrok-tokens/create', {
		data: { label, token, shared: false, isDefault: false, ...over }
	});
	const body = res.ok() ? await res.json() : null;
	return { id: body?.id, label, token, res: body, status: res.status() };
}

export async function listNgrokTokens(request: APIRequestContext) {
	const res = await request.get('/api/ngrok-tokens/list');
	return (await res.json()) as {
		tokens: { id: string; label: string; shared: boolean; isDefault: boolean; isActive: boolean }[];
		serverSecret: boolean;
	};
}

export async function removeNgrokTokens(request: APIRequestContext, ids: (string | undefined)[]) {
	for (const id of ids) if (id) await request.delete(`/api/ngrok-tokens/${id}`);
}
