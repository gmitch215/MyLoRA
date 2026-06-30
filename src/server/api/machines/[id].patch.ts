import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	await ensureDatabase();
	const id = getRouterParam(event, 'id');
	if (!id) throw createError({ statusCode: 400, statusMessage: 'No machine id provided' });
	const { user, machine } = await requireMachineAccess(event, id, 'manage');

	const parsed = machineUpdateSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid machine data')
		});
	}
	const data = parsed.data;
	const caps = await capabilitiesFor(user.role);

	const update: Record<string, unknown> = { updatedAt: new Date() };
	if (data.label !== undefined) update.label = data.label;
	if (data.host !== undefined) update.host = data.host;
	if (data.port !== undefined) update.port = data.port;
	if (data.username !== undefined) update.username = data.username;
	if (data.connectionType !== undefined) update.connectionType = data.connectionType;
	if (data.isActive !== undefined) update.isActive = data.isActive;
	// only managers/admins may toggle sharing
	if (data.shared !== undefined && caps.canManageMachines) update.shared = data.shared;

	await assertEncryptionKey();
	// secrets are update-only: a blank value keeps the stored one
	if (data.privateKey) {
		const enc = await encryptSecret(data.privateKey);
		Object.assign(update, {
			authMethod: 'key',
			keySource: 'provided',
			keyLast4: data.privateKey.replace(/\s/g, '').slice(-4),
			keyCipher: enc.cipher,
			keyIv: enc.iv,
			keyDekCipher: enc.dekCipher,
			keyDekIv: enc.dekIv,
			publicKey: null
		});
	}
	if (data.passphrase) {
		const pe = await encryptSecret(data.passphrase);
		Object.assign(update, {
			passphraseCipher: pe.cipher,
			passphraseIv: pe.iv,
			passphraseDekCipher: pe.dekCipher,
			passphraseDekIv: pe.dekIv
		});
	}
	if (data.password) {
		const pw = await encryptSecret(data.password);
		Object.assign(update, {
			authMethod: 'password',
			passwordCipher: pw.cipher,
			passwordIv: pw.iv,
			passwordDekCipher: pw.dekCipher,
			passwordDekIv: pw.dekIv
		});
	}

	await db.update(machines).set(update).where(eq(machines.id, machine.id));
	const row = (await db.select().from(machines).where(eq(machines.id, machine.id)).limit(1))[0]!;
	return { machine: redactMachine(row) };
});
