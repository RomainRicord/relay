import { useEffect, useMemo, useState } from "react";

import { decryptBytesWithDEK } from "../keys/Function";
import {
    authSignInWithPassword,
    authSignOut,
    authSignUp,
    decodeBytea,
    encodeByteaHex,
    loadSupabaseConfig,
    saveSupabaseConfig,
    storageDownload,
    storageUpload,
    type SupabaseConfig,
} from "../../lib/supabaseRest";
import AuthPanel from "./AuthPanel";
import ConfigPanel from "./ConfigPanel";
import DocumentsPanel from "./DocumentsPanel";
import GroupsPanel from "./GroupsPanel";
import { useSupabaseAccounts } from "./hooks/useSupabaseAccounts";
import { useDevice } from "./hooks/useDevice";
import {
    addGroupMember,
    createGroup,
    getDocumentKeyForDevice,
    insertDocumentKeys,
    insertDocumentRow,
    listDevicesByUserIds,
    listDevicesForUser,
    listDocuments,
    listGroupMembers,
    listGroups,
} from "./lib/docsApi";
import {
    encryptFileForStorage,
    storageFilenameFromDocument,
    unwrapDekForDevice,
    wrapDekForDevices,
} from "./lib/docsCrypto";
import type { DocumentRow, Group, GroupMember } from "./types";
import { downloadBlob, formatError, sanitizeFilename } from "./utils";

export default function Docs() {
    const [configUrl, setConfigUrl] = useState("");
    const [configKey, setConfigKey] = useState("");
    const [status, setStatus] = useState<string | null>(null);

    const accounts = useSupabaseAccounts();
    const session = accounts.session;

    const [authEmail, setAuthEmail] = useState("");
    const [authPassword, setAuthPassword] = useState("");

    const [groups, setGroups] = useState<Group[]>([]);
    const [newGroupName, setNewGroupName] = useState("");
    const [selectedGroupId, setSelectedGroupId] = useState<string>("");
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [inviteUserId, setInviteUserId] = useState("");

    const [documents, setDocuments] = useState<DocumentRow[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const loadedConfig = useMemo(() => loadSupabaseConfig(), []);

    useEffect(() => {
        if (loadedConfig) {
            setConfigUrl(loadedConfig.url);
            setConfigKey(loadedConfig.anonKey);
        }
    }, [loadedConfig]);

    const activeConfig: SupabaseConfig | null = useMemo(() => {
        const loaded = loadSupabaseConfig();
        if (loaded) return loaded;
        if (configUrl && configKey) return { url: configUrl, anonKey: configKey };
        return null;
    }, [configKey, configUrl]);

    const device = useDevice(activeConfig, session);

    useEffect(() => {
        if (!activeConfig || !session) return;
        listGroups(activeConfig, session)
            .then((rows) => setGroups(rows ?? []))
            .catch((e) => setStatus(formatError(e)));
        device.ensureDeviceReady(session).catch((e) => setStatus(formatError(e)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeConfig, session?.userId]);

    useEffect(() => {
        if (!activeConfig || !session || !selectedGroupId) return;
        Promise.all([
            listGroupMembers(activeConfig, session, selectedGroupId),
            listDocuments(activeConfig, session, selectedGroupId),
        ])
            .then(([m, d]) => {
                setMembers(m ?? []);
                setDocuments(d ?? []);
            })
            .catch((e) => setStatus(formatError(e)));
    }, [activeConfig, selectedGroupId, session]);

    function onSaveConfig() {
        saveSupabaseConfig({ url: configUrl, anonKey: configKey });
        setStatus("Config saved.");
    }

    async function onSignUp() {
        if (!activeConfig) return setStatus("Supabase config missing.");
        try {
            const s = await authSignUp(activeConfig, authEmail, authPassword);
            accounts.onAuthSuccess(s);
            setStatus("Signed up.");
        } catch (e) {
            setStatus(formatError(e));
        }
    }

    async function onSignIn() {
        if (!activeConfig) return setStatus("Supabase config missing.");
        try {
            const s = await authSignInWithPassword(activeConfig, authEmail, authPassword);
            accounts.onAuthSuccess(s);
            setStatus("Signed in.");
        } catch (e) {
            setStatus(formatError(e));
        }
    }

    async function onSignOut() {
        if (!activeConfig || !session) return;
        try {
            await authSignOut(activeConfig, session);
        } catch {
            // ignore logout failures (token may already be expired)
        }
        accounts.removeActiveSession();
        setGroups([]);
        setMembers([]);
        setDocuments([]);
        setSelectedGroupId("");
        setStatus("Signed out.");
    }

    async function onCreateGroup() {
        if (!activeConfig || !session) return;
        const name = newGroupName.trim();
        if (!name) return;
        try {
            const created = await createGroup(activeConfig, session, name);
            const groupId = created?.[0]?.id;
            if (!groupId) throw new Error("Group creation failed");
            await addGroupMember(activeConfig, session, groupId, session.userId, "admin");
            setNewGroupName("");
            const rows = await listGroups(activeConfig, session);
            setGroups(rows ?? []);
            setSelectedGroupId(groupId);
            setStatus("Group created.");
        } catch (e) {
            setStatus(formatError(e));
        }
    }

    async function onInviteMember() {
        if (!activeConfig || !session || !selectedGroupId) return;
        const userId = inviteUserId.trim();
        if (!userId) return;
        try {
            if (!device.deviceId || !device.deviceKeys) {
                throw new Error(
                    "This device has no local keypair; cannot share existing documents. Sign in again on this browser (to register a device) and retry."
                );
            }

            await addGroupMember(activeConfig, session, selectedGroupId, userId, "member");
            setStatus("Member added. Sharing existing documents…");

            const newMemberDevices = await listDevicesForUser(activeConfig, session, userId);
            if (!newMemberDevices || newMemberDevices.length === 0) {
                setStatus(
                    "Member added, but they have no devices yet. They must sign in once to register a device, then you can re-add/share keys."
                );
                setInviteUserId("");
                const [m, d] = await Promise.all([
                    listGroupMembers(activeConfig, session, selectedGroupId),
                    listDocuments(activeConfig, session, selectedGroupId),
                ]);
                setMembers(m ?? []);
                setDocuments(d ?? []);
                return;
            }

            const docs = await listDocuments(activeConfig, session, selectedGroupId);
            let shared = 0;
            let skippedMissingOwnKey = 0;
            let skippedBadDeviceKey = 0;

            for (const doc of docs ?? []) {
                const myKeyRow = await getDocumentKeyForDevice(
                    activeConfig,
                    session,
                    doc.id,
                    device.deviceId
                );
                if (!myKeyRow) {
                    skippedMissingOwnKey++;
                    continue;
                }

                const dek = await unwrapDekForDevice({
                    wrapped_dek: myKeyRow.wrapped_dek,
                    wrapped_nonce: myKeyRow.wrapped_nonce,
                    devicePrivateKey: device.deviceKeys.privateKey,
                });

                const { inserts, badDevices } = await wrapDekForDevices({
                    documentId: doc.id,
                    dek,
                    devices: newMemberDevices,
                });
                skippedBadDeviceKey += badDevices.length;
                if (inserts.length === 0) continue;

                await insertDocumentKeys(
                    activeConfig,
                    session,
                    inserts,
                    "document_id,device_id"
                );
                shared += inserts.length;
                setStatus(
                    `Sharing keys… docs=${docs?.length ?? 0}, shared=${shared}, missing_my_key=${skippedMissingOwnKey}, bad_device_key=${skippedBadDeviceKey}`
                );
            }

            setInviteUserId("");
            const [m, d] = await Promise.all([
                listGroupMembers(activeConfig, session, selectedGroupId),
                listDocuments(activeConfig, session, selectedGroupId),
            ]);
            setMembers(m ?? []);
            setDocuments(d ?? []);
            setStatus(
                `Member added. Shared ${shared} keys. Skipped docs without your key: ${skippedMissingOwnKey}. Skipped invalid device keys: ${skippedBadDeviceKey}.`
            );
        } catch (e) {
            setStatus(formatError(e));
        }
    }

    async function onUploadDocument() {
        if (!activeConfig || !session || !device.deviceId || !device.deviceKeys || !selectedGroupId) {
            setStatus("Missing session/device/group.");
            return;
        }
        if (!selectedFile) return;

        try {
            setStatus("Encrypting…");

            const docId = crypto.randomUUID();
            const safeName = sanitizeFilename(selectedFile.name);
            const storageBucket = "docs";
            const storagePath = `${selectedGroupId}/${docId}-${safeName}`;

            const { dek, aad, iv, ciphertext } = await encryptFileForStorage(
                selectedFile,
                selectedGroupId,
                docId
            );

            await insertDocumentRow(activeConfig, session, {
                id: docId,
                group_id: selectedGroupId,
                storage_bucket: storageBucket,
                storage_path: storagePath,
                content_nonce: encodeByteaHex(iv.buffer),
                content_aad: encodeByteaHex(aad),
                content_alg: "aes-256-gcm",
            });

            setStatus("Uploading…");
            await storageUpload(
                activeConfig,
                session,
                storageBucket,
                storagePath,
                new Blob([ciphertext], { type: "application/octet-stream" })
            );

            setStatus("Wrapping keys…");
            const memberRows = await listGroupMembers(activeConfig, session, selectedGroupId);
            const userIds = [...new Set((memberRows ?? []).map((m) => m.user_id))];
            if (userIds.length === 0) throw new Error("No group members found");

            const deviceRows = await listDevicesByUserIds(activeConfig, session, userIds);
            const { inserts, badDevices } = await wrapDekForDevices({
                documentId: docId,
                dek,
                devices: deviceRows ?? [],
            });
            if (inserts.length === 0) {
                throw new Error(
                    `No valid recipient device public keys. Devices to fix: ${badDevices.join(", ")}`
                );
            }
            await insertDocumentKeys(activeConfig, session, inserts);

            setSelectedFile(null);
            const docs = await listDocuments(activeConfig, session, selectedGroupId);
            setDocuments(docs ?? []);
            setStatus("Document stored (E2EE).");
        } catch (e) {
            setStatus(formatError(e));
        }
    }

    async function onDownloadAndDecrypt(doc: DocumentRow) {
        if (!activeConfig || !session || !device.deviceId || !device.deviceKeys) return;
        try {
            setStatus("Fetching key…");
            const keyRow = await getDocumentKeyForDevice(
                activeConfig,
                session,
                doc.id,
                device.deviceId
            );
            if (!keyRow) throw new Error("No key for this device.");

            const dek = await unwrapDekForDevice({
                wrapped_dek: keyRow.wrapped_dek,
                wrapped_nonce: keyRow.wrapped_nonce,
                devicePrivateKey: device.deviceKeys.privateKey,
            });

            setStatus("Downloading…");
            const ciphertext = await storageDownload(
                activeConfig,
                session,
                doc.storage_bucket,
                doc.storage_path
            );

            setStatus("Decrypting…");
            const iv = new Uint8Array(decodeBytea(doc.content_nonce));
            const aad = doc.content_aad ? decodeBytea(doc.content_aad) : undefined;
            const plaintext = await decryptBytesWithDEK(dek, iv, ciphertext, aad);

            downloadBlob(new Blob([plaintext]), storageFilenameFromDocument(doc));
            setStatus("Downloaded & decrypted.");
        } catch (e) {
            setStatus(formatError(e));
        }
    }

    return (
        <div className="w-full max-w-5xl mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 shadow text-zinc-100 space-y-6">
            <h2 className="text-xl font-semibold text-white">Supabase Documents (E2EE)</h2>

            <ConfigPanel
                configUrl={configUrl}
                setConfigUrl={setConfigUrl}
                configKey={configKey}
                setConfigKey={setConfigKey}
                onSaveConfig={onSaveConfig}
                status={status}
                activeConfig={activeConfig}
            />

            <AuthPanel
                activeConfig={activeConfig}
                authEmail={authEmail}
                setAuthEmail={setAuthEmail}
                authPassword={authPassword}
                setAuthPassword={setAuthPassword}
                onSignIn={onSignIn}
                onSignUp={onSignUp}
                onSignOut={onSignOut}
                session={session}
                deviceId={device.deviceId}
                deviceKeysPresent={Boolean(device.deviceKeys)}
                savedSessions={accounts.savedSessions}
                activeUserId={accounts.activeUserId}
                setActiveUserId={accounts.setActiveUserId}
            />

            {session && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <GroupsPanel
                        groups={groups}
                        newGroupName={newGroupName}
                        setNewGroupName={setNewGroupName}
                        onCreateGroup={onCreateGroup}
                        selectedGroupId={selectedGroupId}
                        setSelectedGroupId={setSelectedGroupId}
                        members={members}
                        inviteUserId={inviteUserId}
                        setInviteUserId={setInviteUserId}
                        onInviteMember={onInviteMember}
                    />

                    <DocumentsPanel
                        selectedGroupId={selectedGroupId}
                        selectedFile={selectedFile}
                        setSelectedFile={setSelectedFile}
                        onUploadDocument={onUploadDocument}
                        documents={documents}
                        onDecryptDocument={onDownloadAndDecrypt}
                    />
                </div>
            )}
        </div>
    );
}
