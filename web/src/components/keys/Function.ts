export type Party = {
	name: string;
	kp: CryptoKeyPair | null;
	publicJwk: JsonWebKey | null;
};

export function abToB64(ab: ArrayBuffer) {
	const bytes = new Uint8Array(ab);
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

export function b64ToAb(b64: string) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}

export async function exportPublicJwk(publicKey: CryptoKey) {
	return await crypto.subtle.exportKey("jwk", publicKey);
}

export async function exportPublicKeyRaw(publicKey: CryptoKey) {
	return await crypto.subtle.exportKey("raw", publicKey);
}

export async function importPublicKeyRaw(raw: ArrayBuffer) {
	return await crypto.subtle.importKey(
		"raw",
		raw,
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		[]
	);
}

export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
	return await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true, // extractable (demo). In prod, often false for private key.
		["deriveKey", "deriveBits"]
	);
}

export async function deriveAesKeyECDH(
	ownPrivateKey: CryptoKey,
	otherPublicKey: CryptoKey
) {
	// Derive an AES-GCM key from ECDH shared secret.
	return await crypto.subtle.deriveKey(
		{ name: "ECDH", public: otherPublicKey },
		ownPrivateKey,
		{ name: "AES-GCM", length: 256 },
		false, // not extractable
		["encrypt", "decrypt"]
	);
}

export async function decryptText(
	aesKey: CryptoKey,
	iv_b64: string,
	ciphertext_b64: string
) {
	const iv = new Uint8Array(b64ToAb(iv_b64));
	const ct = b64ToAb(ciphertext_b64);
	const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
	return new TextDecoder().decode(pt);
}

export async function generateDEK(): Promise<CryptoKey> {
	return crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true, // extractable → pour la wrapper
		["encrypt", "decrypt"]
	);
}

export async function encryptWithDEK(dek: CryptoKey, plaintext: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		dek,
		new TextEncoder().encode(plaintext)
	);

	return {
		iv_b64: abToB64(iv.buffer),
		ciphertext_b64: abToB64(ct),
	};
}

export async function encryptClientData(dek: CryptoKey, data: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		dek,
		new TextEncoder().encode(data)
	);
	return {
		iv_b64: abToB64(iv.buffer),
		ciphertext_b64: abToB64(ct),
	};
}

export async function wrapDEKForUser(dek: CryptoKey, recipientPub: CryptoKey) {
	// 1. Generate Ephemeral Key Pair
	const ephKp = await generateECDHKeyPair();

	// 2. Derive Wrapping Key (EphPriv + RecipientPub)
	const wrappingKey = await deriveAesKeyECDH(ephKp.privateKey, recipientPub);

	// 3. Encrypt DEK
	const rawDEK = await crypto.subtle.exportKey("raw", dek);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		wrappingKey,
		rawDEK
	);

	// 4. Export Ephemeral Public Key
	const rawEphPub = await crypto.subtle.exportKey("raw", ephKp.publicKey);

	// 5. Concatenate [EphPub (65)] + [Ciphertext]
	const combined = new Uint8Array(rawEphPub.byteLength + wrapped.byteLength);
	combined.set(new Uint8Array(rawEphPub), 0);
	combined.set(new Uint8Array(wrapped), rawEphPub.byteLength);

	return {
		encrypted_key_b64: abToB64(combined.buffer),
		nonce_b64: abToB64(iv.buffer),
	};
}

export async function unwrapDEK(
	encrypted_key_b64: string,
	nonce_b64: string,
	ownPriv: CryptoKey
): Promise<CryptoKey> {
	const combined = b64ToAb(encrypted_key_b64);
	const combinedBytes = new Uint8Array(combined);

	// 1. Extract EphPub (first 65 bytes for P-256 uncompressed)
	// Note: P-256 raw is 65 bytes (0x04 + 32 + 32)
	const rawEphPub = combinedBytes.slice(0, 65);
	const ciphertext = combinedBytes.slice(65);

	// 2. Import EphPub
	const ephPub = await importPublicKeyRaw(rawEphPub.buffer);

	// 3. Derive Wrapping Key (OwnPriv + EphPub)
	const wrappingKey = await deriveAesKeyECDH(ownPriv, ephPub);

	// 4. Decrypt
	const raw = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: new Uint8Array(b64ToAb(nonce_b64)) },
		wrappingKey,
		ciphertext
	);

	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

export async function decryptWithDEK(
	dek: CryptoKey,
	iv_b64: string,
	ciphertext_b64: string
): Promise<string> {
	const iv = new Uint8Array(b64ToAb(iv_b64));
	const ct = b64ToAb(ciphertext_b64);

	const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, dek, ct);

	return new TextDecoder().decode(pt);
}
