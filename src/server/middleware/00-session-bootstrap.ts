import { kv } from 'hub:kv';

const SESSION_PASSWORD_KV_KEY = 'mylora:session_password';
const MIN_PASSWORD_LEN = 32;

let cachedPassword: string | undefined;
let pendingLoad: Promise<string | undefined> | null = null;

function generatePassword(): string {
	const bytes = new Uint8Array(48);
	crypto.getRandomValues(bytes);
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
	return btoa(s).replace(/=+$/, '');
}

async function loadOrCreate(): Promise<string | undefined> {
	try {
		const existing = await kv.get<string>(SESSION_PASSWORD_KV_KEY);
		if (existing && existing.length >= MIN_PASSWORD_LEN) return existing;
		const next = generatePassword();
		try {
			await kv.set(SESSION_PASSWORD_KV_KEY, next);
		} catch (error) {
			console.warn('failed to persist generated session password to KV:', error);
		}
		return next;
	} catch (error) {
		console.warn('session password KV read failed:', error);
		return undefined;
	}
}

export default defineEventHandler(async (event) => {
	// no bindings (and no sessions) during prerender; skip to avoid KV-binding warnings
	if (import.meta.prerender) return;
	try {
		const cfg = useRuntimeConfig(event);
		const envProvided = cfg.session?.password;
		if (envProvided && envProvided.length >= MIN_PASSWORD_LEN) {
			cachedPassword = envProvided;
			return;
		}
		if (cachedPassword) {
			if (cfg.session) cfg.session.password = cachedPassword;
			return;
		}
		if (!pendingLoad) pendingLoad = loadOrCreate();
		const resolved = await pendingLoad;
		pendingLoad = null;
		if (resolved) {
			cachedPassword = resolved;
			if (cfg.session) cfg.session.password = resolved;
		}
	} catch (error) {
		// never block a request because session bootstrap failed
		console.warn('session bootstrap failed:', error);
		pendingLoad = null;
	}
});
