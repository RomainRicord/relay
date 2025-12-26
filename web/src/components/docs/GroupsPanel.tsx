import type { Group, GroupMember } from "./types";

type Props = {
    groups: Group[];
    newGroupName: string;
    setNewGroupName: (value: string) => void;
    onCreateGroup: () => void;
    selectedGroupId: string;
    setSelectedGroupId: (value: string) => void;
    members: GroupMember[];
    inviteUserId: string;
    setInviteUserId: (value: string) => void;
    onInviteMember: () => void;
};

export default function GroupsPanel(props: Props) {
    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
            <div className="text-sm text-zinc-300">Groups</div>
            <div className="flex gap-2">
                <input
                    value={props.newGroupName}
                    onChange={(e) => props.setNewGroupName(e.target.value)}
                    className="flex-1 rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                    placeholder="New group name"
                />
                <button
                    onClick={props.onCreateGroup}
                    className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
                >
                    Create
                </button>
            </div>

            <select
                value={props.selectedGroupId}
                onChange={(e) => props.setSelectedGroupId(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
            >
                <option value="">Select a group</option>
                {props.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                        {g.name} ({g.id.slice(0, 8)})
                    </option>
                ))}
            </select>

            {props.selectedGroupId && (
                <div className="space-y-2">
                    <div className="text-sm text-zinc-300">Members</div>
                    <div className="space-y-1 text-xs text-zinc-300">
                        {props.members.map((m) => (
                            <div key={m.user_id} className="flex justify-between">
                                <span className="break-all">{m.user_id}</span>
                                <span className="text-zinc-500">{m.role}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input
                            value={props.inviteUserId}
                            onChange={(e) => props.setInviteUserId(e.target.value)}
                            className="flex-1 rounded-xl bg-zinc-950 border border-zinc-800 p-3 text-zinc-100"
                            placeholder="Invite by user UUID"
                        />
                        <button
                            onClick={props.onInviteMember}
                            className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
                        >
                            Add
                        </button>
                    </div>
                    <p className="text-xs text-zinc-500">
                        En self-hosted, tu n'as pas accès aux emails des autres via RLS,
                        donc l'invite se fait par `user_id`.
                    </p>
                </div>
            )}
        </div>
    );
}

