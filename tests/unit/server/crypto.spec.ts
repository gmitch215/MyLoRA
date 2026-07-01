import { beforeAll, describe, expect, it, vi } from 'vitest';

// crypto.ts reads useRuntimeConfig().encryptionKey lazily inside resolveKekSecret; an env key >= 32
// chars wins so we never touch kv. stub it before importing the module.
vi.stubGlobal('useRuntimeConfig', () => ({
	encryptionKey: 'test_encryption_key_at_least_32_chars_long_xx'
}));

let mod: typeof import('../../../src/server/utils/crypto');

beforeAll(async () => {
	mod = await import('../../../src/server/utils/crypto');
});

describe('encryptSecret / decryptSecret round trip', () => {
	it('round-trips a plaintext secret', async () => {
		const plaintext = 'super-secret-token-value';
		const rec = await mod.encryptSecret(plaintext);
		expect(rec.cipher).toBeTruthy();
		expect(rec.iv).toBeTruthy();
		expect(rec.dekCipher).toBeTruthy();
		expect(rec.dekIv).toBeTruthy();
		expect(rec.cipher).not.toContain(plaintext);
		expect(await mod.decryptSecret(rec)).toBe(plaintext);
	});

	it('round-trips unicode and empty strings', async () => {
		for (const s of ['', 'hello world', 'emoji test done', 'multi\nline\tvalue']) {
			expect(await mod.decryptSecret(await mod.encryptSecret(s))).toBe(s);
		}
	});

	it('uses a fresh random iv + dek per call (ciphertexts differ)', async () => {
		const a = await mod.encryptSecret('same');
		const b = await mod.encryptSecret('same');
		expect(a.cipher).not.toBe(b.cipher);
		expect(a.iv).not.toBe(b.iv);
		expect(a.dekCipher).not.toBe(b.dekCipher);
	});

	it('rejects a tampered ciphertext (aes-gcm auth tag)', async () => {
		const rec = await mod.encryptSecret('untampered');
		const bad = { ...rec, cipher: mangleB64(rec.cipher) };
		await expect(mod.decryptSecret(bad)).rejects.toBeTruthy();
	});

	it('rejects a tampered wrapped dek', async () => {
		const rec = await mod.encryptSecret('untampered');
		const bad = { ...rec, dekCipher: mangleB64(rec.dekCipher) };
		await expect(mod.decryptSecret(bad)).rejects.toBeTruthy();
	});
});

describe('encryptToken / decryptToken', () => {
	it('round-trips and exposes only the last4', async () => {
		const token = 'abcdefghijklmnop1234';
		const rec = await mod.encryptToken(token);
		expect(rec.tokenLast4).toBe('1234');
		expect(rec.tokenCipher).not.toContain(token);
		expect(await mod.decryptToken(rec)).toBe(token);
	});

	it('last4 of a short token is the whole token', async () => {
		const rec = await mod.encryptToken('ab');
		expect(rec.tokenLast4).toBe('ab');
	});
});

describe('redactAccount', () => {
	it('keeps only public fields and iso-formats timestamps', () => {
		const row = {
			id: 'acc1',
			label: 'prod',
			accountId: 'cf-account-id',
			tokenLast4: '1234',
			tokenScope: 'edit',
			ownerId: 'u1',
			shared: true,
			isDefault: false,
			adapterCount: 5,
			isActive: true,
			createdAt: '2026-01-02T03:04:05.000Z',
			updatedAt: '2026-01-03T03:04:05.000Z',
			// secret columns that must never leak
			tokenCipher: 'CIPHER',
			tokenIv: 'IV',
			dekCipher: 'DEK',
			dekIv: 'DEKIV'
		} as any;
		const pub = mod.redactAccount(row);
		expect(pub).toEqual({
			id: 'acc1',
			label: 'prod',
			accountId: 'cf-account-id',
			tokenLast4: '1234',
			tokenScope: 'edit',
			ownerId: 'u1',
			shared: true,
			isDefault: false,
			adapterCount: 5,
			isActive: true,
			createdAt: '2026-01-02T03:04:05.000Z',
			updatedAt: '2026-01-03T03:04:05.000Z'
		});
		for (const secret of ['tokenCipher', 'tokenIv', 'dekCipher', 'dekIv']) {
			expect((pub as any)[secret]).toBeUndefined();
		}
	});
});

// flip a couple base64 chars so the bytes decode but fail the gcm tag
function mangleB64(b64: string): string {
	const chars = b64.split('');
	for (let i = 0; i < chars.length && i < 4; i++) {
		chars[i] = chars[i] === 'A' ? 'B' : 'A';
	}
	return chars.join('');
}
