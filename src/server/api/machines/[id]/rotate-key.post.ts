import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

// regenerate the platform keypair; the new public key is shown once for re-install
export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No machine id provided' });
	const { machine } = await requireMachineAccess(event, id, 'manage');

	await assertEncryptionKey();
	const kp = await generateKeypair();
	const enc = await encryptSecret(kp.privateKeyPem);
	await db
		.update(machines)
		.set({
			authMethod: 'key',
			keySource: 'generated',
			publicKey: kp.publicKey,
			keyLast4: kp.last4,
			keyCipher: enc.cipher,
			keyIv: enc.iv,
			keyDekCipher: enc.dekCipher,
			keyDekIv: enc.dekIv,
			// clear any prior password so the row reflects key auth only
			passwordCipher: null,
			passwordIv: null,
			passwordDekCipher: null,
			passwordDekIv: null,
			updatedAt: new Date()
		})
		.where(eq(machines.id, machine.id));
	const row = (await db.select().from(machines).where(eq(machines.id, machine.id)).limit(1))[0]!;
	return { machine: redactMachine(row), publicKey: kp.publicKey };
});
