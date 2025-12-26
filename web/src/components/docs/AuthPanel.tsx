import type { SupabaseConfig, SupabaseSession } from "../../lib/supabaseRest";

type Props = {
    activeConfig: SupabaseConfig | null;
    authEmail: string;
    setAuthEmail: (value: string) => void;
    authPassword: string;
    setAuthPassword: (value: string) => void;
    onSignIn: () => void;
    onSignUp: () => void;
    onSignOut: () => void;
    session: SupabaseSession | null;
    deviceId: string | null;
    deviceKeysPresent: boolean;
    savedSessions: SupabaseSession[];
    activeUserId: string | null;
    setActiveUserId: (value: string | null) => void;
};

export default function AuthPanel(props: Props) {
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
            <div className="text-sm text-zinc-300">Auth</div>

            {props.savedSessions.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs text-zinc-500">
                        Comptes enregistrés (par onglet via sessionStorage)
                    </div>
                    <select
                        value={props.activeUserId ?? ""}
                        onChange={(e) => props.setActiveUserId(e.target.value || null)}
                        className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                    >
                        <option value="">(aucun)</option>
                        {props.savedSessions.map((s) => (
                            <option key={s.userId} value={s.userId}>
                                {s.email ?? "user"} ({s.userId.slice(0, 8)})
                            </option>
                        ))}
                    </select>
                    <div className="text-xs text-zinc-500 break-all">
                        Onglet actif: {props.activeUserId ?? "none"}
                    </div>
                </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
                <input
                    value={props.authEmail}
                    onChange={(e) => props.setAuthEmail(e.target.value)}
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                    placeholder="Email"
                />
                <input
                    type="password"
                    value={props.authPassword}
                    onChange={(e) => props.setAuthPassword(e.target.value)}
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                    placeholder="Password"
                />
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    onClick={props.onSignIn}
                    disabled={!props.activeConfig}
                    className="px-4 py-2 rounded-xl border border-emerald-500/60 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                >
                    Sign in
                </button>
                <button
                    onClick={props.onSignUp}
                    disabled={!props.activeConfig}
                    className="px-4 py-2 rounded-xl border border-sky-500/60 text-sky-200 hover:bg-sky-500/10 disabled:opacity-40"
                >
                    Sign up
                </button>
                <button
                    onClick={props.onSignOut}
                    disabled={!props.session || !props.activeConfig}
                    className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40"
                >
                    Sign out
                </button>
            </div>

            {props.session && (
                <div className="text-xs text-zinc-300 break-all space-y-1">
                    <div>
                        <span className="text-zinc-500">user_id:</span>{" "}
                        {props.session.userId}
                    </div>
                    <div>
                        <span className="text-zinc-500">device_id:</span>{" "}
                        {props.deviceId ?? "not set"}
                    </div>
                    {props.deviceId && !props.deviceKeysPresent && (
                        <div className="text-amber-300">
                            Device keypair missing locally (cannot decrypt).
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

