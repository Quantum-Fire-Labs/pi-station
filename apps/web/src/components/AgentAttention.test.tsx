import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../application/workspace-model";
import { AgentAttention, agentActivitySessions, agentAttentionStatuses, DelegatedChildren, primaryAgentStatus } from "./AgentAttention";

afterEach(cleanup);

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionKey: { hostId: "host", piSessionId: id },
    name: id,
    projection: {
      availability: "available",
      synchronization: "synchronized",
      run: "idle",
      queue: { state: "empty", knownCount: 0 },
      unread: { hasUnread: false },
      management: { kind: "unmanaged" },
      capabilities: [],
    },
    ...overrides,
  };
}

describe("AgentAttention", () => {
  it("nests delegates in visible navigation order and reveals a selected grandchild", () => {
    const root = session("parent");
    const child = session("child", { parentSessionKey: root.sessionKey });
    const grandchild = session("grandchild", { parentSessionKey: child.sessionKey, delegationStatus: "working" });
    const all = [root, child, grandchild];
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const view = render(<AgentAttention sessions={[root]} allSessions={all} onSelect={onSelect} onRemove={onRemove} persistent heading="Sessions" selectedSessionKey={root.sessionKey} />);
    expect(document.querySelectorAll("[data-activity-session]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "1 agent" }));
    expect(document.querySelectorAll("[data-activity-session]")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "1 agent · 1 working" }));
    expect([...document.querySelectorAll("[data-activity-session]")].map((node) => node.getAttribute("data-session-identity"))).toEqual(["host:parent", "host:child", "host:grandchild"]);
    fireEvent.click(screen.getByRole("button", { name: "grandchild: Working" }));
    expect(onSelect).toHaveBeenCalledWith(grandchild.sessionKey);
    expect(screen.queryByRole("button", { name: "Remove child from Sessions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 agent" }));
    expect(screen.queryByRole("button", { name: "grandchild: Working" })).toBeNull();
    view.rerender(<AgentAttention sessions={[root]} allSessions={all} onSelect={onSelect} onRemove={onRemove} persistent heading="Sessions" selectedSessionKey={grandchild.sessionKey} />);
    expect(screen.getByRole("button", { name: "grandchild: Working" }).getAttribute("aria-current")).toBe("page");
  });
  it("deduplicates top-level activity and preserves its source order", () => {
    const working = session("working", { projection: { ...session("x").projection, run: "working" } });
    const idle = session("idle");
    const unreadFailed = session("unread-failed", {
      projection: { ...session("x").projection, synchronization: "failed", unread: { hasUnread: true, unreadCount: 2 } },
    });

    render(<AgentAttention sessions={[working, idle, working, unreadFailed]} onSelect={vi.fn()} />);

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      null,
      "working: Working",
      "unread-failed: Failed",
    ]);
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
  });

  it("excludes delegates and keeps the selected top-level idle Session", () => {
    const parent = session("parent");
    const child = session("child", { parentSessionKey: parent.sessionKey, delegationStatus: "working" });
    expect(agentActivitySessions([parent, child], parent.sessionKey).map(({ sessionKey }) => sessionKey.piSessionId)).toEqual(["parent"]);
  });

  it("keeps existing rows stable when working becomes unread and appends new activity", () => {
    const first = session("first", { projection: { ...session("x").projection, run: "working" } });
    const second = session("second", { projection: { ...session("x").projection, run: "working" } });
    const previous = agentActivitySessions([first, second]).map(({ sessionKey }) => `host:${sessionKey.piSessionId}`);
    const firstUnread = { ...first, projection: { ...first.projection, run: "idle" as const, unread: { hasUnread: true } } };
    const third = session("third", { delegationStatus: "failed" });
    expect(agentActivitySessions([third, second, firstUnread], undefined, previous).map(({ sessionKey }) => sessionKey.piSessionId)).toEqual(["first", "second", "third"]);
  });

  it("returns the complete Session key when selected", () => {
    const onSelect = vi.fn();
    render(<AgentAttention sessions={[session("agent", { projection: { ...session("x").projection, unread: { hasUnread: true } } })]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "agent: Unread" }));
    expect(onSelect).toHaveBeenCalledWith({ hostId: "host", piSessionId: "agent" });
  });

  it("hides when empty and provides a collapsible heading with Project context", () => {
    const view = render(<AgentAttention sessions={[session("idle")]} onSelect={vi.fn()} />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<AgentAttention sessions={[session("ready", { projectId: "project", projection: { ...session("x").projection, unread: { hasUnread: true } } })]} projects={[{ projectId: "project", name: "Pi Station" }]} onSelect={vi.fn()} />);
    const heading = screen.getByRole("button", { name: /Agent Activity/ });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Pi Station")).toBeVisible();
    fireEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "ready: Unread" })).not.toBeInTheDocument();
  });

  it("uses failed, working, unread, then idle status precedence", () => {
    const base = session("agent");
    expect(primaryAgentStatus({ ...base, delegationStatus: "working", projection: { ...base.projection, unread: { hasUnread: true } } })).toBe("Working");
    expect(primaryAgentStatus({ ...base, delegationStatus: "failed", projection: { ...base.projection, run: "working" } })).toBe("Failed");
    expect(primaryAgentStatus({ ...base, projection: { ...base.projection, unread: { hasUnread: true } } })).toBe("Unread");
    expect(agentActivitySessions([base])).toEqual([]);
  });
});

describe("DelegatedChildren", () => {
  it("groups direct children and reports working and failed counts", () => {
    const parent = session("parent");
    const otherParent = { hostId: "host", piSessionId: "other" };
    const working = session("worker", { parentSessionKey: parent.sessionKey, delegationStatus: "working" });
    const failed = session("failed", { parentSessionKey: parent.sessionKey, delegationStatus: "failed" });
    const unrelated = session("other-child", { parentSessionKey: otherParent });

    const view = render(<DelegatedChildren parentSessionKey={parent.sessionKey} sessions={[parent, working, failed, unrelated]} onSelect={vi.fn()} expanded />);

    expect(within(view.container).getByText("2 agents · 1 working · 1 failed")).toBeInTheDocument();
    expect(within(view.container).getAllByRole("button").slice(1).map((button) => button.getAttribute("aria-label"))).toEqual(["worker: Working", "failed: Failed"]);
  });

  it("starts collapsed and expands to select a child", () => {
    const parent = session("parent");
    const onSelect = vi.fn();
    const view = render(<DelegatedChildren parentSessionKey={parent.sessionKey} sessions={[session("child", { parentSessionKey: parent.sessionKey })]} onSelect={onSelect} />);
    const summary = within(view.container).getByRole("button", { name: "1 agent" });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summary);
    fireEvent.click(within(view.container).getByRole("button", { name: "child: Idle" }));
    expect(onSelect).toHaveBeenCalledWith({ hostId: "host", piSessionId: "child" });
  });

  it("maps delegation and projection data without an unavailable approval state", () => {
    expect(agentAttentionStatuses(session("agent", { delegationStatus: "interrupted" }))).toEqual([]);
  });
});
