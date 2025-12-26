import { useEffect, useState } from "react";

import { generateECDHKeyPair } from "../../keys/Function";
import { loadDeviceKeyPair, saveDeviceKeyPair } from "../../../lib/deviceKeyStore";
import type { SupabaseConfig, SupabaseSession } from "../../../lib/supabaseRest";
import { decodeBytea, encodeByteaHex } from "../../../lib/supabaseRest";
import { createDevice, getDeviceById, patchDevicePubKey } from "../lib/docsApi";
import { buffersEqual, DEVICE_ID_STORAGE_KEY_PREFIX } from "../utils";

export function useDevice(activeConfig: SupabaseConfig | null, session: SupabaseSession | null) {
    const [deviceId, setDeviceId] = useState<string | null>(null);
    const [deviceKeys, setDeviceKeys] = useState<CryptoKeyPair | null>(null);

    useEffect(() => {
        if (!session) {
            setDeviceId(null);
            setDeviceKeys(null);
            return;
        }
        setDeviceId(localStorage.getItem(DEVICE_ID_STORAGE_KEY_PREFIX + session.userId));
        setDeviceKeys(null);
    }, [session?.userId]);

    async function ensureDeviceReady(currentSession: SupabaseSession) {
        if (!activeConfig) return;

        const storedDeviceId = localStorage.getItem(
            DEVICE_ID_STORAGE_KEY_PREFIX + currentSession.userId
        );

        if (storedDeviceId) {
            try {
                const existing = await getDeviceById(activeConfig, currentSession, storedDeviceId);
                if (existing?.user_id === currentSession.userId) {
                    const kp = await loadDeviceKeyPair(storedDeviceId);
                    setDeviceId(storedDeviceId);
                    setDeviceKeys(kp);

                    if (kp && existing?.ecdh_pubkey) {
                        const dbPubRaw = decodeBytea(existing.ecdh_pubkey);
                        const localPubRaw = await crypto.subtle.exportKey("raw", kp.publicKey);
                        if (!buffersEqual(dbPubRaw, localPubRaw)) {
                            await patchDevicePubKey(
                                activeConfig,
                                currentSession,
                                storedDeviceId,
                                encodeByteaHex(localPubRaw)
                            );
                        }
                    }
                    return;
                }
            } catch {
                // fallthrough to create a new device
            }
        }

        const kp = await generateECDHKeyPair();
        const rawPub = await crypto.subtle.exportKey("raw", kp.publicKey);
        const created = await createDevice(
            activeConfig,
            currentSession,
            `browser-${navigator.platform ?? "web"}`,
            encodeByteaHex(rawPub)
        );
        const id = created?.[0]?.id;
        if (!id) throw new Error("Device creation failed");

        await saveDeviceKeyPair(id, kp);
        localStorage.setItem(DEVICE_ID_STORAGE_KEY_PREFIX + currentSession.userId, id);
        setDeviceId(id);
        setDeviceKeys(kp);
    }

    return { deviceId, deviceKeys, ensureDeviceReady };
}

