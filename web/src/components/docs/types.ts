export type Group = {
    id: string;
    name: string;
    created_at: string;
    created_by: string;
};

export type GroupMember = {
    user_id: string;
    role: "member" | "admin";
};

export type DeviceRow = {
    id: string;
    user_id: string;
    ecdh_pubkey: string;
    name: string | null;
};

export type DocumentRow = {
    id: string;
    group_id: string;
    storage_bucket: string;
    storage_path: string;
    content_nonce: string;
    content_aad: string | null;
    content_alg: string;
    created_by: string;
    created_at: string;
};

