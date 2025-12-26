export type SupabaseConfig = {
	url: string;
	anonKey: string;
};

export type SupabaseSession = {
	accessToken: string;
	refreshToken: string;
	userId: string;
	email?: string;
	expiresAt?: number;
};

const CONFIG_STORAGE_KEY = "relay_supabase_config_v1";
const SESSION_INDEX_KEY = "relay_supabase_session_index_v1";
const SESSION_KEY_PREFIX = "relay_supabase_session_v1:";

function normalizeUrl(url: string) {
	return url.replace(/\/+$/, "");
}

export function loadSupabaseConfig(): SupabaseConfig | null {
	const envUrl = (import.meta as any).env?.PUBLIC_SUPABASE_URL as string | undefined;
	const envAnonKey = (import.meta as any).env?.PUBLIC_SUPABASE_ANON_KEY as
		| string
		| undefined;

	if (envUrl && envAnonKey) {
		return { url: normalizeUrl(envUrl), anonKey: envAnonKey };
	}

	const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as SupabaseConfig;
		if (!parsed?.url || !parsed?.anonKey) return null;
		return { url: normalizeUrl(parsed.url), anonKey: parsed.anonKey };
	} catch {
		return null;
	}
}

export function saveSupabaseConfig(config: SupabaseConfig) {
	localStorage.setItem(
		CONFIG_STORAGE_KEY,
		JSON.stringify({ url: normalizeUrl(config.url), anonKey: config.anonKey })
	);
}

export function loadSupabaseSession(): SupabaseSession | null {
	throw new Error(
		"loadSupabaseSession() without userId is deprecated; use loadSupabaseSessionForUser(userId)."
	);
}

export function loadSupabaseSessionForUser(userId: string): SupabaseSession | null {
	if (!userId) return null;
	const raw = localStorage.getItem(SESSION_KEY_PREFIX + userId);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as SupabaseSession;
		if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.userId) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function listSupabaseSessions(): SupabaseSession[] {
	const raw = localStorage.getItem(SESSION_INDEX_KEY);
	if (!raw) return [];
	try {
		const userIds = JSON.parse(raw) as string[];
		if (!Array.isArray(userIds)) return [];
		return userIds
			.map((id) => loadSupabaseSessionForUser(id))
			.filter(Boolean) as SupabaseSession[];
	} catch {
		return [];
	}
}

function writeSessionIndex(userIds: string[]) {
	localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify([...new Set(userIds)]));
}

export function saveSupabaseSession(session: SupabaseSession | null) {
	if (!session) return;
	localStorage.setItem(SESSION_KEY_PREFIX + session.userId, JSON.stringify(session));
	const existing = listSupabaseSessions().map((s) => s.userId);
	writeSessionIndex([...existing, session.userId]);
}

export function removeSupabaseSessionForUser(userId: string) {
	if (!userId) return;
	localStorage.removeItem(SESSION_KEY_PREFIX + userId);
	const remaining = listSupabaseSessions().map((s) => s.userId).filter((id) => id !== userId);
	writeSessionIndex(remaining);
}

export function encodeByteaHex(buffer: ArrayBuffer) {
	const bytes = new Uint8Array(buffer);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i].toString(16).padStart(2, "0");
	}
	// Postgres bytea hex format: \xDEADBEEF
	return `\\x${hex}`;
}

export function decodeBytea(value: string): ArrayBuffer {
	// Accept both "\x.." and "\\x.." (in case data was previously over-escaped).
	const normalized = value.replace(/^\\\\+x/, "\\x");
	if (normalized.startsWith("\\x")) {
		const hex = normalized.slice(2);
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		}
		return bytes.buffer;
	}

	// Accept base64url too.
	const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
	const bin = atob(padded);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes.buffer;
}

function supabaseHeaders(config: SupabaseConfig, session?: SupabaseSession | null) {
	const headers: Record<string, string> = {
		apikey: config.anonKey,
	};
	if (session?.accessToken) {
		headers.Authorization = `Bearer ${session.accessToken}`;
	}
	return headers;
}

export async function supabaseJson<T>(
	config: SupabaseConfig,
	path: string,
	options: {
		method?: string;
		session?: SupabaseSession | null;
		body?: any;
		headers?: Record<string, string>;
		query?: Record<string, string>;
		preferReturnRepresentation?: boolean;
	} = {}
): Promise<T> {
	const url = new URL(normalizeUrl(config.url) + path);
	if (options.query) {
		for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
	}

	const res = await fetch(url.toString(), {
		method: options.method ?? (options.body ? "POST" : "GET"),
		headers: {
			...supabaseHeaders(config, options.session),
			...(options.preferReturnRepresentation ? { Prefer: "return=representation" } : {}),
			...(options.body ? { "Content-Type": "application/json" } : {}),
			...(options.headers ?? {}),
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(text || `HTTP ${res.status}`);
	}
	return (text ? (JSON.parse(text) as T) : (undefined as T));
}

export async function authSignUp(
	config: SupabaseConfig,
	email: string,
	password: string
): Promise<SupabaseSession> {
	const data = await supabaseJson<any>(config, "/auth/v1/signup", {
		method: "POST",
		body: { email, password },
	});
	if (!data?.access_token || !data?.refresh_token || !data?.user?.id) {
		throw new Error("Signup failed");
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		userId: data.user.id,
		email: data.user.email,
		expiresAt: data.expires_at,
	};
}

export async function authSignInWithPassword(
	config: SupabaseConfig,
	email: string,
	password: string
): Promise<SupabaseSession> {
	const url = new URL(normalizeUrl(config.url) + "/auth/v1/token");
	url.searchParams.set("grant_type", "password");

	const res = await fetch(url.toString(), {
		method: "POST",
		headers: {
			...supabaseHeaders(config),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ email, password }),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
	const data = JSON.parse(text) as any;
	if (!data?.access_token || !data?.refresh_token || !data?.user?.id) {
		throw new Error("Login failed");
	}
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		userId: data.user.id,
		email: data.user.email,
		expiresAt: data.expires_at,
	};
}

export async function authSignOut(config: SupabaseConfig, session: SupabaseSession) {
	await supabaseJson(config, "/auth/v1/logout", {
		method: "POST",
		session,
	});
}

function encodeStoragePath(path: string) {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

export async function storageUpload(
	config: SupabaseConfig,
	session: SupabaseSession,
	bucket: string,
	path: string,
	body: Blob
) {
	const url = `${normalizeUrl(config.url)}/storage/v1/object/${encodeURIComponent(
		bucket
	)}/${encodeStoragePath(path)}`;
	const tryUpload = async (method: "POST" | "PUT") => {
		const res = await fetch(url, {
			method,
			headers: {
				...supabaseHeaders(config, session),
				"Content-Type": "application/octet-stream",
			},
			body,
		});
		const text = await res.text();
		if (!res.ok) {
			const error = new Error(text || `HTTP ${res.status}`);
			(error as any).status = res.status;
			throw error;
		}
		return text ? JSON.parse(text) : null;
	};

	try {
		return await tryUpload("POST");
	} catch (error: any) {
		if (error?.status === 405) {
			return await tryUpload("PUT");
		}
		throw error;
	}
}

export async function storageDownload(
	config: SupabaseConfig,
	session: SupabaseSession,
	bucket: string,
	path: string
): Promise<ArrayBuffer> {
	const url = `${normalizeUrl(config.url)}/storage/v1/object/${encodeURIComponent(
		bucket
	)}/${encodeStoragePath(path)}`;
	const res = await fetch(url, {
		method: "GET",
		headers: supabaseHeaders(config, session),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `HTTP ${res.status}`);
	}
	return await res.arrayBuffer();
}
