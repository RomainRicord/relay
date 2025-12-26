import type { DocumentRow } from "./types";

type Props = {
    selectedGroupId: string;
    selectedFile: File | null;
    setSelectedFile: (file: File | null) => void;
    onUploadDocument: () => void;
    documents: DocumentRow[];
    onDecryptDocument: (doc: DocumentRow) => void;
};

export default function DocumentsPanel(props: Props) {
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
            <div className="text-sm text-zinc-300">Documents</div>

            <div className="space-y-2">
                <input
                    type="file"
                    onChange={(e) =>
                        props.setSelectedFile(e.target.files?.[0] ?? null)
                    }
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                />
                <button
                    onClick={props.onUploadDocument}
                    disabled={!props.selectedGroupId || !props.selectedFile}
                    className="px-4 py-2 rounded-xl border border-emerald-500/60 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                >
                    Encrypt + upload + share keys
                </button>
            </div>

            <div className="space-y-2">
                {props.documents.length === 0 && (
                    <div className="text-xs text-zinc-500">
                        No documents in this group yet.
                    </div>
                )}
                {props.documents.map((d) => (
                    <div
                        key={d.id}
                        className="rounded-xl bg-zinc-950 border border-zinc-800 p-3 flex items-center justify-between gap-3"
                    >
                        <div className="min-w-0">
                            <div className="text-sm text-white truncate">
                                {d.storage_path.split("/").pop()}
                            </div>
                            <div className="text-xs text-zinc-500 truncate">{d.id}</div>
                        </div>
                        <button
                            onClick={() => props.onDecryptDocument(d)}
                            className="shrink-0 px-3 py-2 rounded-xl border border-sky-500/60 text-sky-200 hover:bg-sky-500/10"
                        >
                            Decrypt
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

