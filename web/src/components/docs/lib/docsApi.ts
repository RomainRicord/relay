import type { SupabaseConfig, SupabaseSession } from "../../../lib/supabaseRest";
import { supabaseJson } from "../../../lib/supabaseRest";
import type { DeviceRow, DocumentRow, Group, GroupMember } from "../types";

export async function listGroups(config: SupabaseConfig, session: SupabaseSession) {
    return await supabaseJson<Group[]>(config, "/rest/v1/groups", {
        session,
        query: { select: "id,name,created_at,created_by", order: "created_at.desc" },
    });
}

export async function createGroup(
    config: SupabaseConfig,
    session: SupabaseSession,
    name: string
) {
    return await supabaseJson<Group[]>(config, "/rest/v1/groups", {
        method: "POST",
        session,
        preferReturnRepresentation: true,
        body: { name },
    });
}

export async function listGroupMembers(
    config: SupabaseConfig,
    session: SupabaseSession,
    groupId: string
) {
    return await supabaseJson<GroupMember[]>(config, "/rest/v1/group_members", {
        session,
        query: {
            select: "user_id,role",
            group_id: `eq.${groupId}`,
            order: "joined_at.asc",
        },
    });
}

export async function addGroupMember(
    config: SupabaseConfig,
    session: SupabaseSession,
    groupId: string,
    userId: string,
    role: "member" | "admin"
) {
    return await supabaseJson(config, "/rest/v1/group_members", {
        method: "POST",
        session,
        body: { group_id: groupId, user_id: userId, role },
    });
}

export async function listDocuments(
    config: SupabaseConfig,
    session: SupabaseSession,
    groupId: string
) {
    return await supabaseJson<DocumentRow[]>(config, "/rest/v1/documents", {
        session,
        query: { select: "*", group_id: `eq.${groupId}`, order: "created_at.desc" },
    });
}

export async function insertDocumentRow(
    config: SupabaseConfig,
    session: SupabaseSession,
    row: Partial<DocumentRow> & { id: string; group_id: string; storage_path: string }
) {
    return await supabaseJson(config, "/rest/v1/documents", {
        method: "POST",
        session,
        body: row,
    });
}

export async function listDevicesByUserIds(
    config: SupabaseConfig,
    session: SupabaseSession,
    userIds: string[]
) {
    const userIdList = userIds.join(",");
    return await supabaseJson<DeviceRow[]>(config, "/rest/v1/devices", {
        session,
        query: { select: "id,user_id,ecdh_pubkey,name", user_id: `in.(${userIdList})` },
    });
}

export async function listDevicesForUser(
    config: SupabaseConfig,
    session: SupabaseSession,
    userId: string
) {
    return await supabaseJson<DeviceRow[]>(config, "/rest/v1/devices", {
        session,
        query: { select: "id,user_id,ecdh_pubkey,name", user_id: `eq.${userId}` },
    });
}

export async function getDeviceById(
    config: SupabaseConfig,
    session: SupabaseSession,
    deviceId: string
) {
    const rows = await supabaseJson<DeviceRow[]>(config, "/rest/v1/devices", {
        session,
        query: {
            select: "id,user_id,name,ecdh_pubkey",
            id: `eq.${deviceId}`,
        },
    });
    return rows?.[0] ?? null;
}

export async function createDevice(
    config: SupabaseConfig,
    session: SupabaseSession,
    name: string,
    ecdhPubkeyBytea: string
) {
    return await supabaseJson<DeviceRow[]>(config, "/rest/v1/devices", {
        method: "POST",
        session,
        preferReturnRepresentation: true,
        body: { name, ecdh_pubkey: ecdhPubkeyBytea },
    });
}

export async function patchDevicePubKey(
    config: SupabaseConfig,
    session: SupabaseSession,
    deviceId: string,
    ecdhPubkeyBytea: string
) {
    return await supabaseJson(config, "/rest/v1/devices", {
        method: "PATCH",
        session,
        query: { id: `eq.${deviceId}` },
        body: { ecdh_pubkey: ecdhPubkeyBytea },
    });
}

export async function insertDocumentKeys(
    config: SupabaseConfig,
    session: SupabaseSession,
    rows: Array<{
        document_id: string;
        device_id: string;
        wrapped_dek: string;
        wrapped_nonce: string;
        wrapped_alg: string;
    }>,
    conflictKeys?: string
) {
    return await supabaseJson(config, "/rest/v1/document_keys", {
        method: "POST",
        session,
        query: conflictKeys ? { on_conflict: conflictKeys } : undefined,
        headers: conflictKeys ? { Prefer: "resolution=ignore-duplicates" } : undefined,
        body: rows,
    });
}

export async function getDocumentKeyForDevice(
    config: SupabaseConfig,
    session: SupabaseSession,
    documentId: string,
    deviceId: string
) {
    const rows = await supabaseJson<any[]>(config, "/rest/v1/document_keys", {
        session,
        query: {
            select: "wrapped_dek,wrapped_nonce",
            document_id: `eq.${documentId}`,
            device_id: `eq.${deviceId}`,
        },
    });
    return rows?.[0] ?? null;
}

