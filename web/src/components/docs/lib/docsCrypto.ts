import {
    abToB64,
    b64ToAb,
    encryptBytesWithDEK,
    generateDEK,
    importPublicKeyRaw,
    unwrapDEK,
    wrapDEKForUser,
} from "../../keys/Function";
import { decodeBytea, encodeByteaHex } from "../../../lib/supabaseRest";
import type { DeviceRow, DocumentRow } from "../types";

export function makeDocumentAAD(groupId: string, docId: string) {
    return new TextEncoder().encode(`relay-doc:${groupId}:${docId}`).buffer;
}

export async function encryptFileForStorage(
    file: File,
    groupId: string,
    docId: string
) {
    const aad = makeDocumentAAD(groupId, docId);
    const plaintext = await file.arrayBuffer();
    const dek = await generateDEK();
    const { iv, ciphertext } = await encryptBytesWithDEK(dek, plaintext, aad);
    return { dek, aad, iv, ciphertext };
}

export async function unwrapDekForDevice(params: {
    wrapped_dek: string;
    wrapped_nonce: string;
    devicePrivateKey: CryptoKey;
}) {
    const encryptedKeyB64 = abToB64(decodeBytea(params.wrapped_dek));
    const nonceB64 = abToB64(decodeBytea(params.wrapped_nonce));
    return await unwrapDEK(encryptedKeyB64, nonceB64, params.devicePrivateKey);
}

export async function wrapDekForDevices(params: {
    documentId: string;
    dek: CryptoKey;
    devices: DeviceRow[];
}) {
    const inserts: Array<{
        document_id: string;
        device_id: string;
        wrapped_dek: string;
        wrapped_nonce: string;
        wrapped_alg: string;
    }> = [];
    const badDevices: string[] = [];

    for (const d of params.devices) {
        try {
            const pubRaw = decodeBytea(d.ecdh_pubkey);
            const pubKey = await importPublicKeyRaw(pubRaw);
            const wrapped = await wrapDEKForUser(params.dek, pubKey);
            inserts.push({
                document_id: params.documentId,
                device_id: d.id,
                wrapped_dek: encodeByteaHex(b64ToAb(wrapped.encrypted_key_b64)),
                wrapped_nonce: encodeByteaHex(b64ToAb(wrapped.nonce_b64)),
                wrapped_alg: "aes-256-gcm",
            });
        } catch {
            badDevices.push(`${d.id} (user ${d.user_id})`);
        }
    }

    return { inserts, badDevices };
}

export function storageFilenameFromDocument(doc: DocumentRow) {
    const filename = doc.storage_path.split("/").pop() ?? `${doc.id}.bin`;
    return filename.replace(/^[0-9a-f-]+-/, "");
}

