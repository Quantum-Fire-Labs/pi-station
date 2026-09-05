import { useEffect, useMemo, useState } from "react";
import type { ApplicationState } from "../application/application-client-base";
import type { SessionKey, SessionSummary } from "../application/workspace-model";
import { agentAttentionStatuses } from "./AgentAttention";

export const globalSessionsStorageKey = "pi-station:global-sessions:v1";
export interface GlobalSessionList { readonly version: 1; readonly order: readonly string[]; readonly dismissed: readonly string[] }
const empty = (): GlobalSessionList => ({ version: 1, order: [], dismissed: [] });
export const globalSessionIdentity = (key: SessionKey): string => JSON.stringify([key.hostId, key.piSessionId]);
const topLevel = (session: SessionSummary): boolean => session.parentSessionKey === undefined && session.quickSession !== true;

export function readGlobalSessions(): GlobalSessionList {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(globalSessionsStorageKey) ?? "null");
    if (value === null || typeof value !== "object") return empty();
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.order) || !record.order.every((id) => typeof id === "string") || !Array.isArray(record.dismissed) || !record.dismissed.every((id) => typeof id === "string")) return empty();
    return { version: 1, order: [...new Set(record.order)], dismissed: [...new Set(record.dismissed)] };
  } catch { return empty(); }
}

export function sessionRootLookup(sessions: readonly SessionSummary[]) {
  const byId = new Map(sessions.map((session) => [globalSessionIdentity(session.sessionKey), session]));
  return (key: SessionKey): SessionSummary | undefined => {
    const seen = new Set<string>();
    let current = byId.get(globalSessionIdentity(key));
    while (current !== undefined) {
      const id = globalSessionIdentity(current.sessionKey);
      if (seen.has(id) || current.quickSession === true) return undefined;
      seen.add(id);
      if (current.parentSessionKey === undefined) return current;
      current = byId.get(globalSessionIdentity(current.parentSessionKey));
    }
    return undefined;
  };
}

/** Add newly opened/active roots, but never remove an entry when its status changes. */
export function reconcileGlobalSessions(list: GlobalSessionList, state: Pick<ApplicationState, "sessions" | "workspaces" | "selectedSessionKey">): GlobalSessionList {
  const rootFor = sessionRootLookup(state.sessions);
  const opened = new Set((state.workspaces ?? []).filter((workspace) => workspace.closedAt === undefined).flatMap((workspace) => workspace.tabs.flatMap((tab) => {
    const root = rootFor({ hostId: tab.projectId, piSessionId: tab.sessionId });
    return root === undefined ? [] : [globalSessionIdentity(root.sessionKey)];
  })));
  const selectedRoot = state.selectedSessionKey === undefined ? undefined : rootFor(state.selectedSessionKey);
  const activeRoots = new Set(state.sessions.flatMap((session) => {
    if (agentAttentionStatuses(session).length === 0) return [];
    const root = rootFor(session.sessionKey);
    return root === undefined ? [] : [globalSessionIdentity(root.sessionKey)];
  }));
  const dismissed = new Set(list.dismissed);
  const seen = new Set(list.order);
  const order = [...list.order];
  for (const session of state.sessions) {
    if (!topLevel(session)) continue;
    const id = globalSessionIdentity(session.sessionKey);
    if (dismissed.has(id) || seen.has(id)) continue;
    if (opened.has(id) || activeRoots.has(id) || (selectedRoot !== undefined && id === globalSessionIdentity(selectedRoot.sessionKey))) {
      order.push(id);
      seen.add(id);
    }
  }
  return order.length === list.order.length ? list : { ...list, order };
}

export function removeGlobalSession(list: GlobalSessionList, key: SessionKey): GlobalSessionList {
  const id = globalSessionIdentity(key);
  return { ...list, order: list.order.filter((candidate) => candidate !== id), dismissed: [...new Set([...list.dismissed, id])] };
}
export function restoreGlobalSession(list: GlobalSessionList, key: SessionKey): GlobalSessionList {
  const id = globalSessionIdentity(key);
  return { ...list, order: [...new Set([...list.order, id])], dismissed: list.dismissed.filter((candidate) => candidate !== id) };
}

/** Global across Workspaces; saved in this browser, not in Pi-owned Session history. */
export function useGlobalSessions(state: ApplicationState, enabled = true) {
  const [stored, setStored] = useState(readGlobalSessions);
  const list = useMemo(() => enabled ? reconcileGlobalSessions(stored, state) : stored, [enabled, stored, state.sessions, state.workspaces, state.selectedSessionKey]);
  useEffect(() => {
    if (!enabled) return;
    if (list !== stored) setStored(list);
    try { localStorage.setItem(globalSessionsStorageKey, JSON.stringify(list)); } catch { /* Keep the list in memory when storage is unavailable. */ }
  }, [enabled, list, stored]);
  useEffect(() => {
    if (!enabled) return;
    const update = (event: StorageEvent): void => { if (event.key === globalSessionsStorageKey) setStored(readGlobalSessions()); };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [enabled]);
  const byId = new Map(state.sessions.filter(topLevel).map((session) => [globalSessionIdentity(session.sessionKey), session]));
  const dismissed = new Set(list.dismissed);
  const sessions = list.order.flatMap((id) => { const session = byId.get(id); return session === undefined || dismissed.has(id) ? [] : [session]; });
  return {
    sessions,
    remove: (key: SessionKey): void => { if (enabled) setStored((previous) => removeGlobalSession(reconcileGlobalSessions(previous, state), key)); },
    restore: (key: SessionKey): void => {
      const root = sessionRootLookup(state.sessions)(key);
      if (enabled && root !== undefined) setStored((previous) => restoreGlobalSession(reconcileGlobalSessions(previous, state), root.sessionKey));
    },
  };
}
