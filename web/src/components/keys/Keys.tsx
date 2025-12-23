import { useContext, useMemo, useState } from "react";

import { AuthContext } from "../../context/useUser";
import {
	decryptWithDEK,
	encryptWithDEK,
	exportPublicJwk,
	generateDEK,
	generateECDHKeyPair,
	unwrapDEK,
	wrapDEKForUser,
} from "./Function";

import type { Party } from "./Function";
/**
 * WebCrypto E2EE demo:
 * - ECDH P-256 (key agreement)
 * - Derive AES-GCM key
 * - Encrypt/decrypt text
 */

export default function KeysManagement() {
	const { user, setUser } = useContext(AuthContext)!;

	const [message, setMessage] = useState(
		"Salut Bob 👋 Ceci est un message E2EE."
	);
	const [encrypted, setEncrypted] = useState<{
		iv_b64: string;
		ciphertext_b64: string;
	} | null>(null);
	const [decrypted, setDecrypted] = useState<string>("");

	const [wrappedDEKForBob, setWrappedDEKForBob] = useState<{
		wrapped_key_b64: string;
		iv_b64: string;
	} | null>(null);

	const [status, setStatus] = useState<string>("Prêt.");

	const ready = useMemo(() => !!user.kp && !!user.kp, [user.kp, user.kp]);

	async function onGenerateKeys() {
		try {
			setStatus("Génération des clés ECDH…");
			const a = await generateECDHKeyPair();
			//const b = await generateECDHKeyPair();

			const aPub = await exportPublicJwk(a.publicKey);
			//const bPub = await exportPublicJwk(b.publicKey);

			setUser({ ...user, kp: a, publicJwk: aPub });
			//setBob({ name: "Bob", kp: b, publicJwk: bPub });
			setEncrypted(null);
			setDecrypted("");
			setStatus("Clés générées ✅");
		} catch (e: any) {
			setStatus(`Erreur: ${e?.message ?? String(e)}`);
		}
	}

	async function onEncryptAsAlice() {
		if (!alice.kp || !bob.kp) return;
		try {
			setStatus("Alice dérive la clé AES partagée (ECDH)…");

			// 1. Générer DEK (une seule fois par client)
			const dek = await generateDEK();

			// 2. Chiffrer les données client
			const enc = await encryptWithDEK(dek, message);

			// 3. Chiffrer la DEK pour Bob
			const wrappedForBob = await wrapDEKForUser(
				dek,
				alice.kp.privateKey,
				bob.kp.publicKey
			);

			setWrappedDEKForBob(wrappedForBob);

			setStatus("Chiffrement AES-GCM…");
			setEncrypted(enc);
			setDecrypted("");
			setStatus(
				"Message chiffré ✅ (le serveur peut stocker ça tel quel)"
			);
		} catch (e: any) {
			setStatus(`Erreur chiffrement: ${e?.message ?? String(e)}`);
		}
	}

	async function onDecryptAsBob() {
		if (!encrypted || !wrappedDEKForBob || !alice.kp || !bob.kp) return;

		try {
			setStatus("Bob récupère la DEK…");

			// 1️⃣ Bob déchiffre la DEK
			const dek = await unwrapDEK(
				wrappedDEKForBob.wrapped_key_b64,
				wrappedDEKForBob.iv_b64,
				bob.kp.privateKey,
				alice.kp.publicKey
			);

			setStatus("Déchiffrement avec DEK…");

			// 2️⃣ Bob déchiffre les données
			const pt = await decryptWithDEK(
				dek,
				encrypted.iv_b64,
				encrypted.ciphertext_b64
			);

			setDecrypted(pt);
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
						Générer clés Alice/Bob
					</button>

					<button
						onClick={onEncryptAsAlice}
						disabled={!ready}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Chiffrer (Alice → Bob)
					</button>

					<button
						onClick={onDecryptAsBob}
						disabled={!encrypted || !ready}
						className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
					>
						Déchiffrer (Bob)
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
						1) Message clair
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

				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow space-y-3">
					<h2 className="text-lg font-semibold text-white">
						2) Sortie chiffrée (stockable en DB)
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
						3) Déchiffré côté Bob
					</h2>
					<div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 text-zinc-100 whitespace-pre-wrap">
						{decrypted || "—"}
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
							Alice public JWK
						</div>
						<pre className="text-xs overflow-auto text-zinc-100 break-all">
							{alice.publicJwk
								? JSON.stringify(alice.publicJwk, null, 2)
								: "—"}
						</pre>
					</div>
					<div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
						<div className="text-sm text-zinc-300 mb-2">
							Bob public JWK
						</div>
						<pre className="text-xs overflow-auto text-zinc-100 break-all">
							{bob.publicJwk
								? JSON.stringify(bob.publicJwk, null, 2)
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
