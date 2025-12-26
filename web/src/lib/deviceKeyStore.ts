const DB_NAME = "relay-docs-e2ee";
const STORE_NAME = "device-keys";

function openDb() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function saveDeviceKeyPair(deviceId: string, kp: CryptoKeyPair) {
	const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
	const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
	const db = await openDb();
	return new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).put({ privateJwk, publicJwk }, deviceId);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function loadDeviceKeyPair(deviceId: string) {
	const db = await openDb();
	return new Promise<CryptoKeyPair | null>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const request = tx.objectStore(STORE_NAME).get(deviceId);
		request.onsuccess = async () => {
			try {
				const value = request.result as
					| { privateJwk: JsonWebKey; publicJwk: JsonWebKey }
					| undefined;
				if (!value) {
					resolve(null);
					return;
				}
				const privateKey = await crypto.subtle.importKey(
					"jwk",
					value.privateJwk,
					{ name: "ECDH", namedCurve: "P-256" },
					true,
					["deriveKey", "deriveBits"]
				);
				const publicKey = await crypto.subtle.importKey(
					"jwk",
					value.publicJwk,
					{ name: "ECDH", namedCurve: "P-256" },
					true,
					[]
				);
				resolve({ privateKey, publicKey });
			} catch (error) {
				reject(error);
			}
		};
		request.onerror = () => reject(request.error);
		tx.oncomplete = () => db.close();
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

