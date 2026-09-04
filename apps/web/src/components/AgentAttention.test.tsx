import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../application/workspace-model";
import { AgentAttention, agentAttentionStatuses, DelegatedChildren } from "./AgentAttention";

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
  it("shows only agents with projected attention states and keeps input order", () => {
    const working = session("working", { projection: { ...session("x").projection, run: "working" } });
    const idle = session("idle");
    const unreadFailed = session("unread-failed", {
      projection: { ...session("x").projection, synchronization: "failed", unread: { hasUnread: true, unreadCount: 2 } },
    });

    render(<AgentAttention sessions={[working, idle, unreadFailed]} onSelect={vi.fn()} />);

    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "working: Working",
      "unread-failed: Failed, Unread",
    ]);
    expect(screen.queryByText("idle")).not.toBeInTheDocument();
  });

  it("returns the complete Session key when selected", () => {
    const onSelect = vi.fn();
    render(<AgentAttention sessions={[session("agent", { projection: { ...session("x").projection, unread: { hasUnread: true } } })]} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "agent: Unread" }));
    expect(onSelect).toHaveBeenCalledWith({ hostId: "host", piSessionId: "agent" });
  });

  it("shows an explicit empty state", () => {
    render(<AgentAttention sessions={[session("idle")]} onSelect={vi.fn()} />);
    expect(screen.getByText("No agents need attention")).toBeInTheDocument();
  });
});

describe("DelegatedChildren", () => {
  it("groups direct children and reports working and failed counts", () => {
    const parent = session("parent");
    const otherParent = { hostId: "host", piSessionId: "other" };
    const working = session("worker", { parentSessionKey: parent.sessionKey, delegationStatus: "working" });
    const failed = session("failed", { parentSessionKey: parent.sessionKey, delegationStatus: "failed" });
    const unrelated = session("other-child", { parentSessionKey: otherParent });

    const view = render(<DelegatedChildren parentSessionKey={parent.sessionKey} sessions={[parent, working, failed, unrelated]} onSelect={vi.fn()} />);

    expect(within(view.container).getByText("2 agents · 1 working · 1 failed")).toBeInTheDocument();
    expect(within(view.container).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["worker: Working", "failed: Failed"]);
  });

  it("can render only the compact summary", () => {
    const parent = session("parent");
    const view = render(<DelegatedChildren parentSessionKey={parent.sessionKey} sessions={[session("child", { parentSessionKey: parent.sessionKey })]} onSelect={vi.fn()} expanded={false} />);
    expect(within(view.container).getByText("1 agent")).toBeInTheDocument();
    expect(within(view.container).queryByRole("button")).not.toBeInTheDocument();
  });

  it("maps delegation and projection data without an unavailable approval state", () => {
    expect(agentAttentionStatuses(session("agent", { delegationStatus: "interrupted" }))).toEqual([]);
  });
});
