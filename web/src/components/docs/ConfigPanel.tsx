import type { SupabaseConfig } from "../../lib/supabaseRest";

type Props = {
    configUrl: string;
    setConfigUrl: (value: string) => void;
    configKey: string;
    setConfigKey: (value: string) => void;
    onSaveConfig: () => void;
    status: string | null;
    activeConfig: SupabaseConfig | null;
};

export default function ConfigPanel(props: Props) {
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
            <div className="text-sm text-zinc-300">Configuration</div>
            <div className="grid md:grid-cols-2 gap-3">
                <input
                    value={props.configUrl}
                    onChange={(e) => props.setConfigUrl(e.target.value)}
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                    placeholder="Supabase URL (ex: http://95.170.26.201:8000)"
                />
                <input
                    value={props.configKey}
                    onChange={(e) => props.setConfigKey(e.target.value)}
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                    placeholder="Anon key"
                />
            </div>
            <button
                onClick={props.onSaveConfig}
                className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
            >
                Save config
            </button>
            {!props.activeConfig && (
                <div className="text-xs text-amber-300">
                    Missing Supabase config (URL + anon key).
                </div>
            )}
            {props.status && (
                <div className="text-xs text-zinc-300 whitespace-pre-wrap break-words">
                    {props.status}
                </div>
            )}
        </div>
    );
}

