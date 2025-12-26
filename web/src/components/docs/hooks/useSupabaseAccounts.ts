import { useEffect, useState } from "react";

import type { SupabaseSession } from "../../../lib/supabaseRest";
import {
    listSupabaseSessions,
    loadSupabaseSessionForUser,
    removeSupabaseSessionForUser,
    saveSupabaseSession,
} from "../../../lib/supabaseRest";
import { ACTIVE_USER_STORAGE_KEY } from "../utils";

export function useSupabaseAccounts() {
    const [activeUserId, setActiveUserId] = useState<string | null>(null);
    const [savedSessions, setSavedSessions] = useState<SupabaseSession[]>([]);
    const [session, setSession] = useState<SupabaseSession | null>(null);

    useEffect(() => {
        const sessions = listSupabaseSessions();
        setSavedSessions(sessions);

        const tabActiveUser = sessionStorage.getItem(ACTIVE_USER_STORAGE_KEY);
        const initialUserId = tabActiveUser || sessions[0]?.userId || null;
        setActiveUserId(initialUserId);
        setSession(initialUserId ? loadSupabaseSessionForUser(initialUserId) : null);
    }, []);

    useEffect(() => {
        if (!activeUserId) {
            sessionStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
            setSession(null);
            return;
        }
        sessionStorage.setItem(ACTIVE_USER_STORAGE_KEY, activeUserId);
        setSavedSessions(listSupabaseSessions());
        setSession(loadSupabaseSessionForUser(activeUserId));
    }, [activeUserId]);

    function onAuthSuccess(next: SupabaseSession) {
        saveSupabaseSession(next);
        setSavedSessions(listSupabaseSessions());
        setActiveUserId(next.userId);
        setSession(next);
    }

    function removeActiveSession() {
        if (!session) return;
        removeSupabaseSessionForUser(session.userId);
        const remaining = listSupabaseSessions();
        setSavedSessions(remaining);
        const nextUserId = remaining[0]?.userId ?? null;
        setActiveUserId(nextUserId);
        setSession(nextUserId ? loadSupabaseSessionForUser(nextUserId) : null);
    }

    return {
        activeUserId,
        setActiveUserId,
        savedSessions,
        session,
        onAuthSuccess,
        removeActiveSession,
    };
}

