import { useContext, useEffect, useMemo, useState } from "react";

import { AuthContext } from "../../context/useUser";
import {
	abToB64,
	b64ToAb,
	decryptWithDEK,
	encryptWithDEK,
	exportPublicJwk,
	exportPublicKeyRaw,
	generateDEK,
	generateECDHKeyPair,
	importPublicKeyRaw,
	unwrapDEK,
	wrapDEKForUser,
} from "./Function";

type Recipient = {
	id: string;
	email: string;
	publicKeyB64: string;
	publicKey: CryptoKey;
};

type EncryptedClient = {
	id: string;
	encryptedPayloadB64: string;
	payloadNonceB64: string;
	encryptedKeyB64: string;
	keyNonceB64: string;
};

const KEY_DB_NAME = "relay-e2ee";
const KEY_STORE = "ecdh-keys";
const KEY_BACKUP_VERSION = 1;
const KEY_BACKUP_ITERATIONS = 200000;

function openKeyDb() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(KEY_DB_NAME, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(KEY_STORE)) {
				db.createObjectStore(KEY_STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function saveKeyPair(userId: string, kp: CryptoKeyPair) {
	const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
	const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
	const db = await openKeyDb();
	return new Promise<void>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, "readwrite");
		const store = tx.objectStore(KEY_STORE);
		store.put({ privateJwk, publicJwk }, userId);
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

async function loadKeyPair(userId: string) {
	const db = await openKeyDb();
	return new Promise<CryptoKeyPair | null>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, "readonly");
		const store = tx.objectStore(KEY_STORE);
		const request = store.get(userId);
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

async function deleteKeyPair(userId: string) {
	const db = await openKeyDb();
	return new Promise<void>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE, "readwrite");
		const store = tx.objectStore(KEY_STORE);
		store.delete(userId);
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

async function deriveBackupKey(password: string, salt: Uint8Array) {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"]
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt,
			iterations: KEY_BACKUP_ITERATIONS,
			hash: "SHA-256",
		},
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

async function encryptKeyPairForBackup(kp: CryptoKeyPair, password: string) {
	const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
	const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
	const payload = JSON.stringify({
		version: KEY_BACKUP_VERSION,
		private_jwk: privateJwk,
		public_jwk: publicJwk,
	});
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveBackupKey(password, salt);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(payload)
	);
	return JSON.stringify({
		version: KEY_BACKUP_VERSION,
		salt_b64: abToB64(salt.buffer),
		iv_b64: abToB64(iv.buffer),
		data_b64: abToB64(ciphertext),
	});
}

async function decryptKeyPairFromBackup(payload: string, password: string) {
	const parsed = JSON.parse(payload) as {
		version: number;
		salt_b64: string;
		iv_b64: string;
		data_b64: string;
	};

	if (parsed.version !== KEY_BACKUP_VERSION) {
		throw new Error("Version de sauvegarde inconnue.");
	}

	const salt = new Uint8Array(b64ToAb(parsed.salt_b64));
	const iv = new Uint8Array(b64ToAb(parsed.iv_b64));
	const key = await deriveBackupKey(password, salt);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		b64ToAb(parsed.data_b64)
	);
	const decoded = JSON.parse(
		new TextDecoder().decode(plaintext)
	) as {
		private_jwk: JsonWebKey;
		public_jwk: JsonWebKey;
	};

	const privateKey = await crypto.subtle.importKey(
		"jwk",
		decoded.private_jwk,
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveKey", "deriveBits"]
	);
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		decoded.public_jwk,
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		[]
	);

	return { privateKey, publicKey };
}

export default function KeysManagement() {
	const { user, setUser } = useContext(AuthContext)!;
	const [recipients, setRecipients] = useState<Recipient[]>([]);
	const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");
	const [encryptedFor, setEncryptedFor] = useState<Recipient | null>(null);
	const [inbox, setInbox] = useState<EncryptedClient[]>([]);
	const [selectedClientId, setSelectedClientId] = useState<string>("");
	const [decryptedMessage, setDecryptedMessage] = useState<string>("");
	const [exportPassword, setExportPassword] = useState<string>("");
	const [exportPayload, setExportPayload] = useState<string>("");
	const [importPassword, setImportPassword] = useState<string>("");
	const [importPayload, setImportPayload] = useState<string>("");

	const [message, setMessage] = useState(
		"Salut Bob 👋 Ceci est un message E2EE."
	);
	const [encrypted, setEncrypted] = useState<{
		iv_b64: string;
		ciphertext_b64: string;
	} | null>(null);

	const [wrappedDEKForRecipient, setWrappedDEKForRecipient] = useState<{
		encrypted_key_b64: string;
		nonce_b64: string;
	} | null>(null);

	const [status, setStatus] = useState<string>("Prêt.");

	const selectedRecipient = useMemo(
		() =>
			recipients.find(
				(recipient) => recipient.id === selectedRecipientId
			) ?? null,
		[recipients, selectedRecipientId]
	);

	const ready = useMemo(
		() => !!user.kp && !!selectedRecipient?.publicKey,
		[user.kp, selectedRecipient]
	);

	const currentUserId = user.id || user.user_id;

	const selectedClient = useMemo(
		() =>
			inbox.find((client) => client.id === selectedClientId) ?? null,
		[inbox, selectedClientId]
	);

	useEffect(() => {
		if (!currentUserId) return;
		let cancelled = false;

		loadKeyPair(currentUserId)
			.then(async (kp) => {
				if (!kp || cancelled) return;
				const publicJwk = await exportPublicJwk(kp.publicKey);
				if (cancelled) return;
				setUser((prev) => ({ ...prev, kp, publicJwk }));
				setStatus("Clé privée restaurée depuis ce navigateur ✅");
			})
			.catch(() => {
				if (!cancelled) {
					setStatus("Impossible de restaurer la clé privée.");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [currentUserId, setUser]);

	async function onGenerateKeys() {
		try {
			if (!currentUserId) {
				setStatus("Identifiant utilisateur manquant.");
				return;
			}
			setStatus("Génération des clés ECDH…");
			const a = await generateECDHKeyPair();

			const aPub = await exportPublicJwk(a.publicKey);

			setUser({ ...user, kp: a, publicJwk: aPub });
			await saveKeyPair(currentUserId, a);
			setEncrypted(null);
			setWrappedDEKForRecipient(null);
			setEncryptedFor(null);
			setDecryptedMessage("");
			setStatus("Clés générées et sauvegardées ✅");
		} catch (e: any) {
			setStatus(`Erreur: ${e?.message ?? String(e)}`);
		}
	}

	async function onForgetPrivateKey() {
		if (!currentUserId) {
			setStatus("Identifiant utilisateur manquant.");
			return;
		}

		try {
			await deleteKeyPair(currentUserId);
			setUser({ ...user, kp: null, publicJwk: null });
			setExportPayload("");
			setImportPayload("");
			setStatus("Clé privée oubliée. Génère une nouvelle paire.");
		} catch (e: any) {
			setStatus(`Erreur suppression: ${e?.message ?? String(e)}`);
		}
	}

	async function onExportKeys() {
		if (!user.kp) {
			setStatus("Génère ta paire de clés avant d'exporter.");
			return;
		}
		if (!exportPassword) {
			setStatus("Mot de passe requis pour l'export.");
			return;
		}

		try {
			setStatus("Chiffrement de la sauvegarde…");
			const payload = await encryptKeyPairForBackup(
				user.kp,
				exportPassword
			);
			setExportPayload(payload);
			setStatus("Export prêt ✅");
		} catch (e: any) {
			setStatus(`Erreur export: ${e?.message ?? String(e)}`);
		}
	}

	function onDownloadExport() {
		if (!exportPayload) {
			setStatus("Exporte d'abord la sauvegarde.");
			return;
		}

		const filename = `${
			currentUserId ? currentUserId : "user"
		}-e2ee-backup.json`;
		const blob = new Blob([exportPayload], {
			type: "application/json;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
		setStatus("Sauvegarde téléchargée ✅");
	}

	async function onImportKeys() {
		if (!currentUserId) {
			setStatus("Identifiant utilisateur manquant.");
			return;
		}
		if (!importPassword || !importPayload) {
			setStatus("Mot de passe et payload requis.");
			return;
		}

		try {
			setStatus("Déchiffrement de la sauvegarde…");
			const kp = await decryptKeyPairFromBackup(
				importPayload,
				importPassword
			);
			const publicJwk = await exportPublicJwk(kp.publicKey);
			setUser({ ...user, kp, publicJwk });
			await saveKeyPair(currentUserId, kp);
			setStatus("Clé importée et sauvegardée ✅");
		} catch (e: any) {
			setStatus(`Erreur import: ${e?.message ?? String(e)}`);
		}
	}

	async function onRegisterPublicKey() {
		if (!user.kp) {
			setStatus("Génère d'abord ta paire de clés.");
			return;
		}

		const token = localStorage.getItem("jwt");
		if (!token) {
			setStatus("JWT manquant. Reconnecte-toi.");
			return;
		}

		try {
			setStatus("Enregistrement de la clé publique…");
			const raw = await exportPublicKeyRaw(user.kp.publicKey);
			const payload = { ecdh_pubkey: abToB64(raw) };

			const res = await fetch("/api/keys/register", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error || res.statusText);
			}

			setStatus("Clé publique enregistrée ✅");
		} catch (e: any) {
			setStatus(`Erreur enregistrement: ${e?.message ?? String(e)}`);
		}
	}

	async function onLoadRecipients() {
		const token = localStorage.getItem("jwt");
		if (!token) {
			setStatus("JWT manquant. Reconnecte-toi.");
			return;
		}

		try {
			setStatus("Chargement des clés publiques…");
			const res = await fetch("/api/users", {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error || res.statusText);
			}

			const data = (await res.json()) as Array<{
				id: string;
				email: string;
				ecdh_pubkey: string;
			}>;

			const currentUserId = user.id || user.user_id;
			const filtered = data.filter(
				(entry) => entry.id !== currentUserId
			);
			const mapped = await Promise.all(
				filtered.map(async (entry) => ({
					id: entry.id,
					email: entry.email,
					publicKeyB64: entry.ecdh_pubkey,
					publicKey: await importPublicKeyRaw(
						b64ToAb(entry.ecdh_pubkey)
					),
				}))
			);

			setRecipients(mapped);
			if (
				mapped.length > 0 &&
				!mapped.some(
					(recipient) => recipient.id === selectedRecipientId
				)
			) {
				setSelectedRecipientId(mapped[0].id);
			}
			setStatus(
				mapped.length > 0
					? "Clés publiques chargées ✅"
					: "Aucune clé publique disponible."
			);
		} catch (e: any) {
			setStatus(`Erreur chargement: ${e?.message ?? String(e)}`);
		}
	}

	async function onEncryptAsAlice() {
		if (!user.kp || !selectedRecipient) {
			setStatus("Choisis un destinataire et génère tes clés.");
			return;
		}
		try {
			setStatus("Génération d'une DEK par message…");

			// 1. Générer DEK (une seule fois par client)
			const dek = await generateDEK();

			// 2. Chiffrer les données client
			const enc = await encryptWithDEK(dek, message);

			// 3. Chiffrer la DEK pour le destinataire
			const wrappedForBob = await wrapDEKForUser(
				dek,
				selectedRecipient.publicKey
			);

			setWrappedDEKForRecipient(wrappedForBob);
			setEncryptedFor(selectedRecipient);
			setDecryptedMessage("");

			setStatus("Chiffrement AES-GCM…");
			setEncrypted(enc);
			setStatus(
				"Message chiffré ✅ (le serveur peut stocker ça tel quel)"
			);
		} catch (e: any) {
			setStatus(`Erreur chiffrement: ${e?.message ?? String(e)}`);
		}
	}

	async function onStoreEncryptedData() {
		if (!encrypted || !wrappedDEKForRecipient || !encryptedFor) {
			setStatus("Chiffre un message avant de l'envoyer.");
			return;
		}

		const token = localStorage.getItem("jwt");
		if (!token) {
			setStatus("JWT manquant. Reconnecte-toi.");
			return;
		}

		try {
			setStatus("Envoi des données chiffrées…");
			const res = await fetch("/api/clients", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					encrypted_payload: encrypted.ciphertext_b64,
					nonce: encrypted.iv_b64,
					keys: [
						{
							user_id: encryptedFor.id,
							encrypted_key:
								wrappedDEKForRecipient.encrypted_key_b64,
							nonce: wrappedDEKForRecipient.nonce_b64,
						},
					],
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error || res.statusText);
			}

			const data = await res.json().catch(() => null);
			if (data?.id) {
				setStatus(`Données stockées ✅ (id: ${data.id})`);
			} else {
				setStatus("Données stockées ✅");
			}
		} catch (e: any) {
			setStatus(`Erreur envoi: ${e?.message ?? String(e)}`);
		}
	}

	async function onLoadInbox() {
		const token = localStorage.getItem("jwt");
		if (!token) {
			setStatus("JWT manquant. Reconnecte-toi.");
			return;
		}

		try {
			setStatus("Chargement des messages chiffrés…");
			const res = await fetch("/api/clients", {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error || res.statusText);
			}

			const data = (await res.json()) as Array<{
				id: string;
				encrypted_payload: string;
				payload_nonce: string;
				encrypted_key: string;
				key_nonce: string;
			}>;

			const mapped = data.map((entry) => ({
				id: entry.id,
				encryptedPayloadB64: entry.encrypted_payload,
				payloadNonceB64: entry.payload_nonce,
				encryptedKeyB64: entry.encrypted_key,
				keyNonceB64: entry.key_nonce,
			}));

			setInbox(mapped);
			if (
				mapped.length > 0 &&
				!mapped.some((client) => client.id === selectedClientId)
			) {
				setSelectedClientId(mapped[0].id);
			}
			setStatus(
				mapped.length > 0
					? "Messages chargés ✅"
					: "Aucun message chiffré trouvé."
			);
		} catch (e: any) {
			setStatus(`Erreur chargement: ${e?.message ?? String(e)}`);
		}
	}

	async function onDecryptSelected() {
		if (!selectedClient) {
			setStatus("Sélectionne un message.");
			return;
		}
		if (!user.kp) {
			setStatus("Génère tes clés avant de déchiffrer.");
			return;
		}

		try {
			setStatus("Récupération de la DEK…");
			const dek = await unwrapDEK(
				selectedClient.encryptedKeyB64,
				selectedClient.keyNonceB64,
				user.kp.privateKey
			);

			setStatus("Déchiffrement du message…");
			const plaintext = await decryptWithDEK(
				dek,
				selectedClient.payloadNonceB64,
				selectedClient.encryptedPayloadB64
			);

			setDecryptedMessage(plaintext);
			setStatus("Message déchiffré ✅");
		} catch (e: any) {
			setStatus(`Erreur déchiffrement: ${e?.message ?? String(e)}`);
		}
	}

	return (
		<div className="max-w-4xl mx-auto p-6 space-y-6 flex flex-col flex-wrap">
			<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow">
				<p className="text-zinc-300 mt-2">
					ECDH (P-256) → dérivation d’une clé AES-GCM →
					chiffrement/déchiffrement.
				</p>

				<div className="mt-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
					<button
						onClick={onGenerateKeys}
						className="px-4 py-2 rounded-xl bg-white text-zinc-950 font-medium hover:opacity-90"
					>
						Générer mes clés
					</button>

					<button
						onClick={onForgetPrivateKey}
						disabled={!user.kp}
						className="px-4 py-2 rounded-xl border border-amber-500/60 text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
					>
						Oublier ma clé privée
					</button>

					<button
						onClick={onRegisterPublicKey}
						disabled={!user.kp}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Enregistrer ma clé publique
					</button>

					<button
						onClick={onLoadRecipients}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Charger les clés publiques
					</button>

					<button
						onClick={onEncryptAsAlice}
						disabled={!ready}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Chiffrer pour un destinataire
					</button>

					<div className="sm:ml-auto text-sm text-zinc-300 flex items-center">
						<span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-2" />
						{status}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 p-4 sm:p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800 shadow-lg">
				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-3">
					<h2 className="text-lg font-semibold text-white">
						1) Destinataire
					</h2>
					<select
						value={selectedRecipientId}
						onChange={(e) => setSelectedRecipientId(e.target.value)}
						className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
					>
						<option value="">— Choisis un utilisateur —</option>
						{recipients.map((recipient) => (
							<option key={recipient.id} value={recipient.id}>
								{recipient.email} ({recipient.id})
							</option>
						))}
					</select>
					<div className="text-xs text-zinc-400">
						Clé publique chargée depuis le backend.
					</div>
					<div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-xs text-zinc-100 break-all">
						{selectedRecipient?.publicKeyB64 ?? "—"}
					</div>
				</div>

				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-3">
					<h2 className="text-lg font-semibold text-white">
						2) Message clair
					</h2>
					<textarea
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100 wrap-break-words"
					/>
					<p className="text-xs text-zinc-400">
						Ici tu écris le contenu. En E2EE, le serveur ne voit
						jamais ça.
					</p>
				</div>

				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-3 md:col-span-2">
					<h2 className="text-lg font-semibold text-white">
						3) Sortie chiffrée (stockable en DB)
					</h2>

					<div className="space-y-2">
						<label className="text-sm text-zinc-300">
							IV (base64)
						</label>
						<input
							readOnly
							value={encrypted?.iv_b64 ?? ""}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
							placeholder="Clique “Chiffrer”…"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm text-zinc-300">
							Ciphertext (base64)
						</label>
						<textarea
							readOnly
							value={encrypted?.ciphertext_b64 ?? ""}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100 wrap-break-words"
							placeholder="Clique “Chiffrer”…"
						/>
					</div>
				</div>

				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-3 md:col-span-2">
					<h2 className="text-lg font-semibold text-white">
						4) DEK chiffrée pour le destinataire
					</h2>
					<div className="space-y-2">
						<label className="text-sm text-zinc-300">
							Clé chiffrée (base64)
						</label>
						<textarea
							readOnly
							value={
								wrappedDEKForRecipient?.encrypted_key_b64 ?? ""
							}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100 wrap-break-words"
							placeholder="Clique “Chiffrer”…"
						/>
					</div>
					<div className="space-y-2">
						<label className="text-sm text-zinc-300">
							Nonce (base64)
						</label>
						<input
							readOnly
							value={wrappedDEKForRecipient?.nonce_b64 ?? ""}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
							placeholder="Clique “Chiffrer”…"
						/>
					</div>

					<button
						onClick={onStoreEncryptedData}
						disabled={
							!encrypted ||
							!wrappedDEKForRecipient ||
							!encryptedFor
						}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Envoyer au serveur
					</button>
				</div>
			</div>

			<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-4">
				<div className="flex flex-col sm:flex-row sm:items-center gap-3">
					<h2 className="text-lg font-semibold text-white">
						Réception & déchiffrement
					</h2>
					<button
						onClick={onLoadInbox}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
					>
						Charger mes messages
					</button>
					<button
						onClick={onDecryptSelected}
						disabled={!selectedClient || !user.kp}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Déchiffrer le message
					</button>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
						<label className="text-sm text-zinc-300">
							Message chiffré
						</label>
						<select
							value={selectedClientId}
							onChange={(e) =>
								setSelectedClientId(e.target.value)
							}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
						>
							<option value="">— Sélectionne un message —</option>
							{inbox.map((client) => (
								<option key={client.id} value={client.id}>
									{client.id}
								</option>
							))}
						</select>
						<div className="text-xs text-zinc-400 break-all">
							{selectedClient?.encryptedPayloadB64 ?? "—"}
						</div>
					</div>

					<div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
						<label className="text-sm text-zinc-300">
							Message déchiffré
						</label>
						<div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100 whitespace-pre-wrap min-h-[120px]">
							{decryptedMessage || "—"}
						</div>
					</div>
				</div>
			</div>

			<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-6">
				<h2 className="text-lg font-semibold text-white">
					Sauvegarde chiffrée (multi-appareils)
				</h2>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
						<label className="text-sm text-zinc-300">
							Exporter (mot de passe)
						</label>
						<input
							type="password"
							value={exportPassword}
							onChange={(e) => setExportPassword(e.target.value)}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
							placeholder="Mot de passe fort"
						/>
						<button
							onClick={onExportKeys}
							disabled={!user.kp || !exportPassword}
							className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
						>
							Chiffrer la sauvegarde
						</button>
						<button
							onClick={onDownloadExport}
							disabled={!exportPayload}
							className="px-4 py-2 rounded-xl border border-emerald-500/60 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
						>
							Télécharger la sauvegarde
						</button>
						<textarea
							readOnly
							value={exportPayload}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100 text-xs min-h-[140px]"
							placeholder="Le JSON chiffré apparaîtra ici…"
						/>
					</div>

					<div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
						<label className="text-sm text-zinc-300">
							Importer (JSON chiffré)
						</label>
						<textarea
							value={importPayload}
							onChange={(e) => setImportPayload(e.target.value)}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100 text-xs min-h-[140px]"
							placeholder="Colle ici le JSON exporté…"
						/>
						<input
							type="password"
							value={importPassword}
							onChange={(e) => setImportPassword(e.target.value)}
							className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
							placeholder="Mot de passe de sauvegarde"
						/>
						<button
							onClick={onImportKeys}
							disabled={!importPassword || !importPayload}
							className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
						>
							Déchiffrer et importer
						</button>
					</div>
				</div>
			</div>

			<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow">
				<h2 className="text-lg font-semibold text-white">
					Clés publiques (ex: à envoyer au serveur)
				</h2>
				<div className="grid md:grid-cols-2 gap-4 mt-3">
					<div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
						<div className="text-sm text-zinc-300 mb-2">
							Ma clé publique (JWK)
						</div>
						<pre className="text-xs overflow-auto text-zinc-100 break-all">
							{user.publicJwk
								? JSON.stringify(user.publicJwk, null, 2)
								: "—"}
						</pre>
					</div>
					<div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
						<div className="text-sm text-zinc-300 mb-2">
							Destinataire sélectionné
						</div>
						<pre className="text-xs overflow-auto text-zinc-100 break-all">
							{selectedRecipient
								? JSON.stringify(
										{
											id: selectedRecipient.id,
											email: selectedRecipient.email,
										},
										null,
										2
									)
								: "—"}
						</pre>
					</div>
				</div>

				<p className="text-xs text-zinc-400 mt-3">
					Le serveur stocke uniquement les <b>clés publiques</b> + les{" "}
					<b>messages chiffrés</b>. Les{" "}
					<b>clés privées restent dans le navigateur</b>.
				</p>
			</div>
		</div>
	);
}
