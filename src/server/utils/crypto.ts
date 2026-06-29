import { kv } from 'hub:kv';
import type { CloudflareAccount } from '~/server/db/schema';
import type { PublicCloudflareAccount } from '~/shared/types';

const KEK_KV_KEY = 'mylora:kek';
const ENC_CHECK_KV_KEY = 'mylora:enc_check';
const ENC_CHECK_PLAINTEXT = 'mylora-enc-sentinel-v1';

let cachedKek: CryptoKey | null = null;
let cachedKekRaw: string | null = null;
let pendingKek: Promise<string> | null = null;

function b64encode(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// derive a 256-bit aes-gcm key from an arbitrary-length secret string
async function deriveKey(secret: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// resolve the raw KEK secret: env wins, else auto-generate + persist in KV
async function resolveKekSecret(): Promise<string> {
	if (cachedKekRaw) return cachedKekRaw;
	const envKey = useRuntimeConfig().encryptionKey;
	if (envKey && envKey.length >= 32) {
		cachedKekRaw = envKey;
		return envKey;
	}
	if (pendingKek) return pendingKek;
	pendingKek = (async () => {
		try {
			const existing = await kv.get<string>(KEK_KV_KEY);
			if (existing && existing.length >= 32) {
				cachedKekRaw = existing;
				return existing;
			}
			const generated = b64encode(crypto.getRandomValues(new Uint8Array(48)));
			await kv.set(KEK_KV_KEY, generated);
			cachedKekRaw = generated;
			return generated;
		} finally {
			pendingKek = null;
		}
	})();
	return pendingKek;
}

async function getKek(): Promise<CryptoKey> {
	if (cachedKek) return cachedKek;
	const secret = await resolveKekSecret();
	cachedKek = await deriveKey(secret);
	return cachedKek;
}

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

	return { cipher: b64encode(new Uint8Array(cipher)), iv: b64encode(iv) };
}

async function aesDecrypt(
	key: CryptoKey,
	cipherB64: string,
	ivB64: string
): Promise<Uint8Array<ArrayBuffer>> {
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: new Uint8Array(b64decode(ivB64)) },
		key,
		b64decode(cipherB64)
	);
	return new Uint8Array(plain);
}

export type EncryptedToken = {
	tokenCipher: string;
	tokenIv: string;
	dekCipher: string;
	dekIv: string;
	tokenLast4: string;
};

// envelope-encrypt a token: random dek encrypts the token, the KEK wraps the dek
export async function encryptToken(token: string): Promise<EncryptedToken> {
	const kek = await getKek();
	const dekRaw = crypto.getRandomValues(new Uint8Array(32));
	const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
	const tok = await aesEncrypt(dek, new TextEncoder().encode(token));
	const wrapped = await aesEncrypt(kek, dekRaw);
	return {
		tokenCipher: tok.cipher,
		tokenIv: tok.iv,
		dekCipher: wrapped.cipher,
		dekIv: wrapped.iv,
		tokenLast4: token.slice(-4)
	};
}

export async function decryptToken(rec: {
	tokenCipher: string;
	tokenIv: string;
	dekCipher: string;
	dekIv: string;
}): Promise<string> {
	const kek = await getKek();
	const dekRaw = await aesDecrypt(kek, rec.dekCipher, rec.dekIv);
	const dek = await crypto.subtle.importKey('raw', dekRaw, { name: 'AES-GCM' }, false, ['decrypt']);
	const tokenBytes = await aesDecrypt(dek, rec.tokenCipher, rec.tokenIv);

	return new TextDecoder().decode(tokenBytes);
}

// detect a wrong/rotated KEK; throws a clear error so callers can tell users to re-enter tokens
export async function assertEncryptionKey(): Promise<void> {
	const kek = await getKek();
	try {
		const stored = await kv.get<{ cipher: string; iv: string }>(ENC_CHECK_KV_KEY);
		if (!stored) {
			const sealed = await aesEncrypt(kek, new TextEncoder().encode(ENC_CHECK_PLAINTEXT));
			await kv.set(ENC_CHECK_KV_KEY, { cipher: sealed.cipher, iv: sealed.iv });
			return;
		}
		const decoded = new TextDecoder().decode(await aesDecrypt(kek, stored.cipher, stored.iv));
		if (decoded !== ENC_CHECK_PLAINTEXT) throw new Error('mismatch');
	} catch {
		throw createError({
			statusCode: 500,
			statusMessage:
				'Encryption key changed or invalid; stored Cloudflare tokens cannot be decrypted. Re-enter account tokens.'
		});
	}
}

// strip every secret field; only the last4 ever leaves the server
export function redactAccount(row: CloudflareAccount): PublicCloudflareAccount {
	return {
		id: row.id,
		label: row.label,
		accountId: row.accountId,
		tokenLast4: row.tokenLast4,
		tokenScope: row.tokenScope,
		ownerId: row.ownerId,
		shared: row.shared,
		isDefault: row.isDefault,
		adapterCount: row.adapterCount,
		isActive: row.isActive,
		createdAt: new Date(row.createdAt).toISOString(),
		updatedAt: new Date(row.updatedAt).toISOString()
	};
}
