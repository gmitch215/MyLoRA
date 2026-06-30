import { eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { machines } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	const user = await requireAuthed(event);
	await ensureDatabase();
	const caps = await capabilitiesFor(user.role);
	// developers may register their own machines; managing/sharing requires canManageMachines
	if (!caps.canManageMachines && !caps.canTrain) {
		throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
	}

	const parsed = machineCreateSchema.safeParse(await readBody(event));
	if (!parsed.success) {
		throw createError({
			statusCode: 400,
			statusMessage: firstZodIssueMessage(parsed.error.issues, 'Invalid machine data')
		});
	}
	const data = parsed.data;
	// sharing a machine with everyone requires the manage capability
	if (data.shared && !caps.canManageMachines) {
		throw createError({
			statusCode: 403,
			statusMessage: 'Sharing a machine requires the Manage Machines capability'
		});
	}
	await assertEncryptionKey();

	const id = crypto.randomUUID().replace(/-/g, '');
	const cols: Record<string, unknown> = { authMethod: data.authMethod };
	let publicKey: string | undefined;

	if (data.authMethod === 'password') {
		const enc = await encryptSecret(data.password!);
		Object.assign(cols, {
			passwordCipher: enc.cipher,
			passwordIv: enc.iv,
			passwordDekCipher: enc.dekCipher,
			passwordDekIv: enc.dekIv
		});
	} else {
		let pem: string;
		if (data.keySource === 'generated') {
			const kp = await generateKeypair();
			pem = kp.privateKeyPem;
			publicKey = kp.publicKey;
			cols.publicKey = kp.publicKey;
			cols.keyLast4 = kp.last4;
			cols.keySource = 'generated';
		} else {
			pem = data.privateKey!;
			cols.keySource = 'provided';
			cols.keyLast4 = pem.replace(/\s/g, '').slice(-4);
		}
		const enc = await encryptSecret(pem);
		Object.assign(cols, {
			keyCipher: enc.cipher,
			keyIv: enc.iv,
			keyDekCipher: enc.dekCipher,
			keyDekIv: enc.dekIv
		});
		if (data.passphrase) {
			const pe = await encryptSecret(data.passphrase);
			Object.assign(cols, {
				passphraseCipher: pe.cipher,
				passphraseIv: pe.iv,
				passphraseDekCipher: pe.dekCipher,
				passphraseDekIv: pe.dekIv
			});
		}
	}

	// a tunnel machine gets a self-report token (shown once) so the box can auto-heal its address
	let selfReportToken: string | undefined;
	if (data.connectionType === 'tunnel') {
		selfReportToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
		cols.selfReportTokenHash = await hashSelfReportToken(selfReportToken);
	}

	await db.insert(machines).values({
		id,
		label: data.label,
		ownerId: user.id,
		shared: !!data.shared,
		host: data.host,
		port: data.port,
		username: data.username,
		connectionType: data.connectionType,
		...cols
	});

	// the first connectivity check is always manual: a new machine stays 'unchecked' until the user
	// installs the public key and clicks Test Connection (auto-testing here would race the key
	// install and report a misleading auth failure)
	const row = (await db.select().from(machines).where(eq(machines.id, id)).limit(1))[0]!;
	return { machine: redactMachine(row), publicKey, selfReportToken };
});
