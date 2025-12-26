export const DEVICE_ID_STORAGE_KEY_PREFIX = "relay_supabase_device_id_v1:";
export const ACTIVE_USER_STORAGE_KEY = "relay_supabase_active_user_v1";

export function sanitizeFilename(filename: string) {
    return (
        filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file.bin"
    );
}

export function formatError(error: unknown) {
    if (error && typeof error === "object") {
        const anyError = error as any;
        const name = typeof anyError.name === "string" ? anyError.name : "Error";
        const message = typeof anyError.message === "string" ? anyError.message : "";
        const stack = typeof anyError.stack === "string" ? anyError.stack : "";
        if (message || stack) {
            return [name + (message ? `: ${message}` : ""), stack]
                .filter(Boolean)
                .join("\n");
        }
        try {
            return JSON.stringify(error);
        } catch {
            return name;
        }
    }
    return String(error);
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export function buffersEqual(a: ArrayBuffer, b: ArrayBuffer) {
    if (a.byteLength !== b.byteLength) return false;
    const av = new Uint8Array(a);
    const bv = new Uint8Array(b);
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
}

