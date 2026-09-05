// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureState } from "../fixtures/workspace";
import type { ApplicationState } from "../application/application-client-base";
import { globalSessionIdentity, globalSessionsStorageKey, readGlobalSessions, reconcileGlobalSessions, removeGlobalSession, restoreGlobalSession, useGlobalSessions, type GlobalSessionList } from "./use-global-sessions";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const root = fixtureState.sessions[0]!;
const idle = { ...root, projection: { ...root.projection, run: "idle" as const, unread: { hasUnread: false } } };
const state: ApplicationState = { ...fixtureState, sessions: [root], selectedSessionKey: root.sessionKey, workspaces: [] };
const empty: GlobalSessionList = { version: 1, order: [], dismissed: [] };

describe("Global Sessions", () => {
  it("restores the parent when a delegated Session is explicitly opened", () => {
    const child = { ...root, sessionKey: { ...root.sessionKey, piSessionId: "child" }, parentSessionKey: root.sessionKey };
    const value = { ...state, sessions: [idle, child], selectedSessionKey: child.sessionKey };
    const hook = renderHook(() => useGlobalSessions(value));
    expect(hook.result.current.sessions).toEqual([idle]);
    act(() => hook.result.current.remove(root.sessionKey));
    expect(hook.result.current.sessions).toEqual([]);
    act(() => hook.result.current.restore(child.sessionKey));
    expect(hook.result.current.sessions).toEqual([idle]);
  });
  it("does not guess an orphan delegate's parent", () => {
    const child = { ...root, sessionKey: { ...root.sessionKey, piSessionId: "orphan" }, parentSessionKey: root.sessionKey };
    expect(reconcileGlobalSessions(empty, { ...state, sessions: [child], selectedSessionKey: child.sessionKey }).order).toEqual([]);
  });
  it("keeps completion and read Sessions in place across remounts and Workspace changes", () => {
    const hook = renderHook(({ value }) => useGlobalSessions(value), { initialProps: { value: state } });
    expect(hook.result.current.sessions.map((session) => session.sessionKey)).toEqual([root.sessionKey]);
    const settled = { ...state, sessions: [idle], selectedSessionKey: undefined, activeWorkspaceId: undefined };
    hook.rerender({ value: settled });
    expect(hook.result.current.sessions).toEqual([idle]);
    hook.unmount();
    const reopened = renderHook(() => useGlobalSessions(settled));
    expect(reopened.result.current.sessions).toEqual([idle]);
  });
  it("keeps a removed active Session dismissed until explicitly reopened", () => {
    const hook = renderHook(() => useGlobalSessions(state));
    act(() => hook.result.current.remove(root.sessionKey));
    expect(hook.result.current.sessions).toEqual([]);
    hook.unmount();
    const reopened = renderHook(() => useGlobalSessions(state));
    expect(reopened.result.current.sessions).toEqual([]);
    act(() => reopened.result.current.restore(root.sessionKey));
    expect(reopened.result.current.sessions).toEqual([root]);
  });
  it("does not import idle history, delegates, or Quick Sessions", () => {
    const candidates = { ...state, selectedSessionKey: undefined, sessions: [idle, { ...root, parentSessionKey: root.sessionKey }, { ...root, quickSession: true as const }] };
    expect(reconcileGlobalSessions(empty, candidates)).toEqual(empty);
  });
  it("seeds idle roots from any open Workspace, not closed Workspaces", () => {
    const tab = { id: "tab", kind: "session" as const, projectId: idle.sessionKey.hostId, sessionId: idle.sessionKey.piSessionId };
    const workspace = { id: "work", name: "Work", tabs: [tab], projectIds: [], closedProjectIds: [], bookmarkedProjectIds: [] };
    const input = { ...state, selectedSessionKey: undefined, sessions: [idle], workspaces: [workspace] };
    expect(reconcileGlobalSessions(empty, input).order).toEqual([globalSessionIdentity(idle.sessionKey)]);
    expect(reconcileGlobalSessions(empty, { ...input, workspaces: [{ ...workspace, closedAt: "2026-09-05T00:00:00Z" }] }).order).toEqual([]);
  });
  it("preserves missing references and uses full host identity", () => {
    const other = { ...root.sessionKey, hostId: "another-host" as typeof root.sessionKey.hostId };
    const registered = restoreGlobalSession(restoreGlobalSession(empty, root.sessionKey), other);
    expect(reconcileGlobalSessions(registered, { ...state, sessions: [] }).order).toHaveLength(2);
    expect(removeGlobalSession(registered, root.sessionKey).order).toEqual([globalSessionIdentity(other)]);
  });
  it("does not change the list for embedded Sessions and tolerates malformed storage", () => {
    localStorage.setItem(globalSessionsStorageKey, "broken");
    expect(readGlobalSessions()).toEqual(empty);
    const hook = renderHook(() => useGlobalSessions(state, false));
    act(() => hook.result.current.restore(root.sessionKey));
    expect(localStorage.getItem(globalSessionsStorageKey)).toBe("broken");
  });
});
