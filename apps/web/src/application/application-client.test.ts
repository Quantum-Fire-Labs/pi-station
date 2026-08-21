import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedSession } from "@pi-station/application-protocol";
import { mapTimeline, ApplicationClient, toolSummary, upsertSessionSummary } from "./application-client";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.EventSource = originalEventSource;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fetchPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, EventListener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close(): void {}
}

const saved = (id: string, modifiedAt: string, state: "open" | "closed" = "open"): SavedSession => ({
  id,
  projectId: "project",
  path: `/${id}.jsonl`,
  modifiedAt,
  state,
});

describe("Pi Station incremental Session summaries", () => {
  it("adds and orders one changed Session without replacing unchanged objects", () => {
    const unchanged = upsertSessionSummary([], saved("old", "2026-01-01T00:00:00.000Z"))[0]!;
    const sessions = upsertSessionSummary([unchanged], saved("new", "2026-01-02T00:00:00.000Z"));

    expect(sessions.map((item) => item.sessionKey.piSessionId)).toEqual(["new", "old"]);
    expect(sessions[1]).toBe(unchanged);
  });

  it("uses the working directory as the Session display path", () => {
    const summary = upsertSessionSummary([], {
      ...saved("outside", "2026-01-01T00:00:00.000Z"),
      cwd: "/work/outside",
    })[0];

    expect(summary?.displayPath).toBe("/work/outside");
  });

  it("allows model and thinking changes for an open Quick Session without general Session management", () => {
    const quick = upsertSessionSummary([], {
      ...saved("quick", "2026-01-01T00:00:00.000Z"),
      quickSession: true,
    })[0]!;

    expect(quick.projection.capabilities).toEqual(expect.arrayContaining(["session.model.set", "session.thinking.set"]));
    expect(quick.projection.capabilities).not.toEqual(expect.arrayContaining(["session.rename", "session.clone", "session.close"]));
  });

  it("updates close and open state in place by stable Session ID", () => {
    const open = upsertSessionSummary([], saved("one", "2026-01-01T00:00:00.000Z"));
    const closed = upsertSessionSummary(open, saved("one", "2026-01-01T00:00:00.000Z", "closed"));
    expect(closed).toHaveLength(1);
    expect(closed[0]?.projection.availability).toBe("closed");

    const opened = upsertSessionSummary(closed, saved("one", "2026-01-01T00:00:00.000Z"));
    expect(opened[0]?.projection.availability).toBe("available");
  });

  it("projects delegated Session parentage and Working status for sidebar nesting", () => {
    const child = upsertSessionSummary([], {
      ...saved("child", "2026-01-01T00:00:00.000Z"),
      parentSessionId: "parent",
      delegationStatus: "working",
    })[0];
    expect(child?.parentSessionKey).toEqual({ hostId: "project", piSessionId: "parent" });
    expect(child?.projection.run).toBe("working");
  });

  it("projects attention into unread state without changing Working state", () => {
    const summary = upsertSessionSummary([], {
      ...saved("attention", "2026-01-02T00:00:00.000Z"),
      unread: { hasUnread: true, latestAttentionId: "attention-1" },
    })[0];
    expect(summary?.projection.unread).toEqual({ hasUnread: true, latestUnreadTurnId: "attention-1" });
    expect(summary?.projection.run).toBe("idle");
  });

  it("suppresses delegated child unread state in snapshots and incremental updates", () => {
    const child = {
      ...saved("child", "2026-01-02T00:00:00.000Z"),
      parentSessionId: "parent",
      delegationStatus: "working" as const,
      unread: { hasUnread: true, latestAttentionId: "attention-child" },
    };
    const working = upsertSessionSummary([], child)[0];
    const completed = upsertSessionSummary([working!], { ...child, delegationStatus: "completed" })[0];
    const nested = upsertSessionSummary([completed!], { ...child, id: "grandchild", parentSessionId: "child" })[0];
    const { parentSessionId, ...former } = child;
    expect(parentSessionId).toBe("parent");
    const formerChild = upsertSessionSummary([nested!], former)[0];

    expect(working?.projection.unread).toEqual({ hasUnread: false });
    expect(completed?.projection.unread).toEqual({ hasUnread: false });
    expect(nested?.projection.unread).toEqual({ hasUnread: false });
    expect(formerChild?.projection.unread).toEqual({ hasUnread: true, latestUnreadTurnId: "attention-child" });
  });

  it("keeps one Session when its derived Project changes", () => {
    const first = upsertSessionSummary([], saved("same", "2026-01-01T00:00:00.000Z"));
    const other = { ...saved("same", "2026-01-02T00:00:00.000Z"), projectId: "other" };
    const changed = upsertSessionSummary(first, other);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.projectId).toBe("other");
  });

  it("marks selected unread attention read only when the Session is visible", async () => {
    class FakeEventSource {
      addEventListener(): void {}
      close(): void {}
    }
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const unread = { ...saved("one", "2026-01-02T00:00:00.000Z"), unread: { hasUnread: true, latestAttentionId: "attention-1" } };
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = fetchPath(input);
      if (path === "/v2/projects") return Promise.resolve(Response.json({ projects: [{ id: "project", root: "/work" }], bookmarks: [] }));
      if (path === "/v2/sessions") return Promise.resolve(Response.json({ sequence: 0, sessions: [unread], bookmarks: [] }));
      if (path.endsWith("/read") && init?.method === "POST") return Promise.resolve(Response.json({ unread: { hasUnread: false } }));
      if (path === "/v2/projects/project/sessions/one") return Promise.resolve(Response.json({ version: 2, session: unread, phase: "idle", timeline: [], settings: { modelInventory: [], supportedThinkingLevels: ["off"] } }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();
    client.setSelectedVisible(false);
    client.connect();
    await vi.waitFor(() => expect(client.snapshot.selectedSessionKey?.piSessionId).toBe("one"));
    expect(fetchMock.mock.calls.some(([path]) => fetchPath(path).endsWith("/read"))).toBe(false);

    client.setSelectedVisible(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/v2/projects/project/sessions/one/read",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ attentionId: "attention-1" }) }),
    ));
    expect(client.snapshot.sessions[0]?.projection.run).toBe("idle");
    await vi.waitFor(() => expect(client.snapshot.sessions[0]?.projection.unread.hasUnread).toBe(false));
    client.stop();
  });

  it("settles unselected and concurrent Session indicators from the global authoritative stream", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const one = saved("one", "2026-01-02T00:00:00.000Z");
    const two = saved("two", "2026-01-01T00:00:00.000Z");
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const path = fetchPath(input);
      if (path === "/v2/projects") return Promise.resolve(Response.json({ projects: [{ id: "project", root: "/work" }], bookmarks: [] }));
      if (path === "/v2/sessions") return Promise.resolve(Response.json({
        sequence: 0, sessions: [one, two], bookmarks: [], phases: [
          { projectId: "project", sessionId: "one", phase: "working", epoch: "epoch", generation: 1 },
          { projectId: "project", sessionId: "two", phase: "working", epoch: "epoch", generation: 1 },
        ],
      }));
      if (path.endsWith("/one")) return Promise.resolve(Response.json({ version: 2, eventCursor: 0, session: one, phase: "working", phaseEpoch: "epoch", phaseGeneration: 1, timeline: [], settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const client = new ApplicationClient();
    client.connect();
    await vi.waitFor(() => {
      expect(client.snapshot.sessions).toHaveLength(2);
      expect(client.snapshot.sessions.every((item) => item.projection.run === "working")).toBe(true);
    });
    const globalStream = FakeEventSource.instances.find((source) => source.url.startsWith("/v2/sessions/events"))!;

    globalStream.emit("session.phase", { version: 2, type: "session.phase", session: { projectId: "project", sessionId: "two", phase: "idle", epoch: "epoch", generation: 2 } });
    globalStream.emit("session.updated", { version: 2, type: "session.updated", session: { ...two, name: "Delegated child completed", delegationStatus: "completed" } });

    expect(client.snapshot.sessions.find((item) => item.sessionKey.piSessionId === "two")?.projection.run).toBe("idle");
    expect(client.snapshot.sessions.find((item) => item.sessionKey.piSessionId === "one")?.projection.run).toBe("working");
    client.stop();
  });

  it("reconciles a missed terminal event on reconnect with a new server epoch", async () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const session = saved("missed", "2026-01-01T00:00:00.000Z");
    let epoch = "old";
    let phase: "working" | "idle" = "working";
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const path = fetchPath(input);
      if (path === "/v2/projects") return Promise.resolve(Response.json({ projects: [{ id: "project", root: "/work" }], bookmarks: [] }));
      if (path === "/v2/sessions") return Promise.resolve(Response.json({ sequence: 0, sessions: [session], bookmarks: [], phases: [{ projectId: "project", sessionId: "missed", phase, epoch, generation: 0 }] }));
      if (path.endsWith("/missed")) return Promise.resolve(Response.json({ version: 2, eventCursor: 0, session, phase, phaseEpoch: epoch, phaseGeneration: 0, timeline: [], settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const client = new ApplicationClient();
    client.connect();
    await vi.waitFor(() => expect(client.snapshot.sessions[0]?.projection.run).toBe("working"));
    epoch = "new";
    phase = "idle";
    const globalStream = FakeEventSource.instances.find((source) => source.url.startsWith("/v2/sessions/events"))!;
    globalStream.emit("open", {});
    globalStream.emit("open", {});

    await vi.waitFor(() => expect(client.snapshot.sessions[0]?.projection.run).toBe("idle"));

    globalStream.emit("session.phase", { version: 2, type: "session.phase", session: { projectId: "project", sessionId: "missed", phase: "working", epoch: "new", generation: 1 } });
    expect(client.snapshot.sessions[0]?.projection.run).toBe("working");
    epoch = "wake";
    phase = "idle";
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(client.snapshot.sessions[0]?.projection.run).toBe("idle"));
    client.stop();
  });

  it("applies normalized Working and Idle phase updates to selected and Session projections", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const session = saved("phase-session", "2026-01-01T00:00:00.000Z");
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const path = fetchPath(input);
      if (path.endsWith("/phase-session")) return Promise.resolve(Response.json({ version: 2, session, phase: "idle", timeline: [], settings: { modelInventory: [], supportedThinkingLevels: ["off"] } }));
      if (path.endsWith("/shared-files")) return Promise.resolve(Response.json({ sharedFiles: [] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const client = new ApplicationClient();

    client.select({ hostId: "project", piSessionId: "phase-session" });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]?.emit("phase", { version: 2, type: "phase", phase: "working", generation: 1 });
    expect(client.snapshot.selected.projection?.run).toBe("working");
    expect(client.snapshot.sessions.find((item) => item.sessionKey.piSessionId === "phase-session")?.projection.run).toBe("working");

    FakeEventSource.instances[0]?.emit("phase", { version: 2, type: "phase", phase: "idle", generation: 2 });
    expect(client.snapshot.selected.projection?.run).toBe("idle");
    expect(client.snapshot.sessions.find((item) => item.sessionKey.piSessionId === "phase-session")?.projection.run).toBe("idle");
    client.stop();
  });

  it("does not let Session metadata or an older snapshot replace a newer Working phase", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const session = saved("ordered", "2026-01-01T00:00:00.000Z");
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const path = fetchPath(input);
      if (path === "/v2/projects") return Promise.resolve(Response.json({ projects: [{ id: "project", root: "/work" }], bookmarks: [] }));
      if (path === "/v2/sessions") return Promise.resolve(Response.json({ sequence: 0, sessions: [session], bookmarks: [] }));
      if (path.endsWith("/ordered")) return Promise.resolve(Response.json({ version: 2, eventCursor: 0, session, phase: "idle", phaseGeneration: 1, timeline: [], historyRevision: "one", hasEarlierHistory: false, settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const client = new ApplicationClient();
    client.connect();
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    const phaseStream = FakeEventSource.instances.find((source) => source.url.includes("/ordered/events"));
    const metadataStream = FakeEventSource.instances.find((source) => source.url.startsWith("/v2/sessions/events"));
    phaseStream?.emit("phase", { version: 2, type: "phase", phase: "working", generation: 2 });
    metadataStream?.emit("session.updated", { version: 2, type: "session.updated", session: { ...session, name: "Renamed" } });
    phaseStream?.emit("open", {});
    phaseStream?.emit("open", {});

    await vi.waitFor(() => expect(client.snapshot.sessions[0]?.name).toBe("Renamed"));
    expect(client.snapshot.selected.projection?.run).toBe("working");
    expect(client.snapshot.sessions[0]?.projection.run).toBe("working");
    client.stop();
  });

  it("orders phase state by server epoch and per-Session generation across reconnect and reload", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const session = saved("restart-safe", "2026-01-01T00:00:00.000Z");
    let view = { version: 2, eventCursor: 0, session, phase: "working", phaseEpoch: "old-epoch", phaseGeneration: 900, timeline: [], historyRevision: "one", hasEarlierHistory: false, settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [] };
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const path = fetchPath(input);
      if (path.endsWith("/restart-safe")) return Promise.resolve(Response.json(view));
      if (path.endsWith("/shared-files")) return Promise.resolve(Response.json({ sharedFiles: [] }));
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    const client = new ApplicationClient();
    client.select({ hostId: "project", piSessionId: "restart-safe" });
    await vi.waitFor(() => expect(client.snapshot.selected.projection?.run).toBe("working"));
    const stream = FakeEventSource.instances[0]!;

    stream.emit("phase", { version: 2, type: "phase", phase: "idle", epoch: "new-epoch", generation: 1 });
    expect(client.snapshot.selected.projection?.run).toBe("idle");
    stream.emit("phase", { version: 2, type: "phase", phase: "working", epoch: "old-epoch", generation: 901 });
    stream.emit("phase", { version: 2, type: "phase", phase: "working", epoch: "new-epoch", generation: 0 });
    expect(client.snapshot.selected.projection?.run).toBe("idle");

    view = { ...view, phase: "working", phaseEpoch: "new-epoch", phaseGeneration: 2, session: { ...session, name: "Updated" } };
    stream.emit("open", {});
    stream.emit("open", {});
    await vi.waitFor(() => expect(client.snapshot.selected.projection?.run).toBe("working"));
    expect(client.snapshot.selected.details?.name).toBe("Updated");

    client.stop();
    const reloadedClient = new ApplicationClient();
    reloadedClient.select({ hostId: "project", piSessionId: "restart-safe" });
    await vi.waitFor(() => expect(reloadedClient.snapshot.selected.projection?.run).toBe("working"));
    reloadedClient.stop();
  });

  it("maps saved image IDs without leaking data or filesystem paths", () => {
    const key = { hostId: "project", piSessionId: "session" } as never;
    const mapped = mapTimeline([{
      id: "user-1",
      kind: "user",
      text: "Inspect this",
      images: [
        { id: "saved_image-1", mediaType: "image/png", status: "available" },
        { status: "unavailable" },
      ],
    }], key, "saved");

    expect(mapped).toEqual([expect.objectContaining({
      timelineItemId: "user-1",
      category: "user-message",
      content: {
        text: "Inspect this",
        images: [
          { mediaType: "image/png", historyImageId: "saved_image-1" },
          { unavailable: true },
        ],
      },
    })]);
    expect(JSON.stringify(mapped)).not.toContain("jsonl");
    expect(JSON.stringify(mapped)).not.toContain("data:");
  });

  it("keeps one tool card through live lifecycle, replay, and saved reconciliation", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const view = {
      version: 2, eventCursor: 4, session: saved("session", "2026-01-01T00:00:00.000Z"), phase: "working",
      timeline: [], historyRevision: "one", hasEarlierHistory: false,
      settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [],
    };
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json(view));
    const client = new ApplicationClient();
    client.select({ hostId: "project", piSessionId: "session" });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const stream = FakeEventSource.instances[0]!;
    const start = { version: 2, type: "tool", toolCallId: "call-1", title: "read", inputText: "one", state: "running" };
    const end = { version: 2, type: "tool", toolCallId: "call-1", title: "read", outputText: "done", state: "succeeded" };
    stream.emit("tool", start);
    stream.emit("tool", start);
    stream.emit("tool", end);
    expect(client.snapshot.selected.timeline).toHaveLength(1);
    expect(client.snapshot.selected.timeline[0]).toMatchObject({ timelineItemId: "tool-call-call-1", content: { toolCallId: "call-1", inputText: "one", outputText: "done", state: "succeeded" } });

    stream.emit("timeline", { version: 2, type: "timeline", timeline: [
      { id: "tool-call-call-1", kind: "tool", toolCallId: "call-1", title: "read", inputText: "one", text: "done", state: "succeeded" },
      { id: "tool-call-call-2", kind: "tool", toolCallId: "call-2", title: "read", inputText: "two", text: "done too", state: "succeeded" },
      { id: "delegation-report", kind: "tool", title: "delegate_to_agent · completed", text: "Report", state: "succeeded" },
    ] });
    expect(client.snapshot.selected.timeline).toHaveLength(3);
    expect(client.snapshot.selected.timeline.map((item) => item.category === "tool-activity" ? item.content.toolCallId : undefined)).toEqual(["call-1", "call-2", "delegation-report"]);
    client.stop();
  });

  it("shows the requested model in a delegation tool summary", () => {
    expect(toolSummary("delegate_to_agent", JSON.stringify({
      prompt: "Review this",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    }))).toBe("delegate_to_agent · anthropic/claude-sonnet-4-6");
    expect(toolSummary("delegate_to_agent", JSON.stringify({ prompt: "Review this" }))).toBe("delegate_to_agent");
  });

  it("does not add a pagination overlap with the same stable tool-call ID", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const tool = { id: "tool-call-call-1", kind: "tool", toolCallId: "call-1", title: "read", text: "done", state: "succeeded" };
    const view = { version: 2, eventCursor: 0, session: saved("session", "2026-01-01T00:00:00.000Z"), phase: "idle", timeline: [tool], historyRevision: "revision", historyBefore: "cursor", hasEarlierHistory: true, settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [] };
    const page = { version: 2, revision: "revision", timeline: [tool], hasEarlier: false };
    globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(view)).mockResolvedValueOnce(Response.json(page));
    const client = new ApplicationClient();
    client.select({ hostId: "project", piSessionId: "session" });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(client.requestEarlierHistory()).toBe(true);
    await vi.waitFor(() => expect(client.snapshot.historyLoading).toBe(false));
    expect(client.snapshot.selected.timeline).toHaveLength(1);
    client.stop();
  });

  it("replaces optimistic state with one settled saved-image message", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const view = {
      version: 2,
      session: saved("session", "2026-01-01T00:00:00.000Z"),
      phase: "idle",
      timeline: [],
      settings: { modelInventory: [], supportedThinkingLevels: ["off"] },
    };
    globalThis.fetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(view), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    const client = new ApplicationClient();
    const key = { hostId: "project", piSessionId: "session" } as never;

    client.select(key);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    client.executeCommand({ kind: "prompt.send", text: "Inspect", imageIds: ["upload-1"] } as never);
    expect(client.snapshot.selected.timeline).toHaveLength(1);
    expect(client.snapshot.selected.timeline[0]?.timelineItemId).toMatch(/^rpc-optimistic-/u);

    FakeEventSource.instances[0]!.emit("timeline", {
      version: 2,
      type: "timeline",
      timeline: [{
        id: "user-settled",
        kind: "user",
        text: "Inspect",
        images: [{ id: "saved_image-1", mediaType: "image/webp", status: "available" }],
      }],
    });

    expect(client.snapshot.selected.timeline).toHaveLength(1);
    expect(client.snapshot.selected.timeline[0]).toMatchObject({
      timelineItemId: "user-settled",
      content: { images: [{ mediaType: "image/webp", historyImageId: "saved_image-1" }] },
    });
  });

  it("uses the authoritative view cursor and reconciles after an event-stream reconnect", async () => {
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const initial = {
      version: 2,
      eventCursor: 12,
      session: saved("session", "2026-01-01T00:00:00.000Z"),
      phase: "idle",
      timeline: [{ id: "initial", kind: "user", text: "Initial" }],
      settings: { modelInventory: [], supportedThinkingLevels: ["off"] },
    };
    const reconciled = {
      ...initial,
      eventCursor: 18,
      session: saved("session", "2026-01-02T00:00:00.000Z"),
      timeline: [{ id: "external", kind: "user", text: "From terminal Pi" }],
    };
    globalThis.fetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(initial))
      .mockResolvedValueOnce(Response.json(reconciled));
    const client = new ApplicationClient();

    client.select({ hostId: "project", piSessionId: "session" });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]?.url).toBe("/v2/projects/project/sessions/session/events?after=12");

    FakeEventSource.instances[0]!.emit("open", {});
    FakeEventSource.instances[0]!.emit("open", {});
    await vi.waitFor(() => expect(client.snapshot.selected.timeline[0]?.timelineItemId).toBe("external"));
    expect(client.snapshot.selected.historyRevision).toBe("2026-01-02T00:00:00.000Z");
    client.stop();
  });

  it("uploads images through the Pi Station route and reports server errors", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "upload-1" }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Image data does not match its file type" }), { status: 400, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();
    const file = new File(["png"], "screen.png", { type: "image/png" });

    await expect(client.uploadImage(file)).resolves.toBe("upload-1");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/v2/images", expect.objectContaining({
      method: "POST",
      body: file,
    }));
    await expect(client.uploadImage(file)).rejects.toThrow("Image data does not match its file type");
  });

  it("maps normalized shared files from an SDK Session view into Workspace details", async () => {
    class FakeEventSource {
      static readonly instances: FakeEventSource[] = [];
      readonly listeners = new Map<string, EventListener>();
      constructor() { FakeEventSource.instances.push(this); }
      addEventListener(type: string, listener: EventListener) { this.listeners.set(type, listener); }
      close() {}
      emit(type: string, value: unknown) {
        this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(value) }));
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const session = saved("session-with-file", "2026-01-01T00:00:00.000Z");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [{ id: "project", root: "/project" }], bookmarks: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sequence: 0, sessions: [session], bookmarks: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 2,
        session,
        phase: "idle",
        timeline: [],
        settings: { modelInventory: [], supportedThinkingLevels: ["off"] },
        sharedFiles: [{ name: "notes.md", url: "/shared/session-with-file/notes.md", size: 12, modifiedAt: 1 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 2,
        sharedFiles: [{ name: "result.txt", url: "/shared/session-with-file/result.txt", size: 6, modifiedAt: 2 }],
      }), { status: 200 }));
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();

    client.connect();
    await vi.waitFor(() => expect(client.snapshot.selected.details?.sharedFiles).toEqual([
      { name: "notes.md", url: "/shared/session-with-file/notes.md", size: 12, modifiedAt: 1 },
    ]));
    expect(JSON.stringify(client.snapshot.selected.details?.sharedFiles)).not.toContain("modelRuntime");

    FakeEventSource.instances[1]?.emit("phase", { version: 2, type: "phase", phase: "idle", generation: 2 });
    await vi.waitFor(() => expect(client.snapshot.selected.details?.sharedFiles).toEqual([
      { name: "result.txt", url: "/shared/session-with-file/result.txt", size: 6, modifiedAt: 2 },
    ]));
    expect(fetchMock).toHaveBeenLastCalledWith("/v2/projects/project/sessions/session-with-file/shared-files", { cache: "no-store" });
    client.stop();
  });

  it("removes a Project and all of its current client views", async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (path === "/v2/projects") return Promise.resolve(new Response(JSON.stringify({ projects: [{ id: "project", root: "/project" }], bookmarks: [{ projectId: "project", position: 0 }] })));
      if (path === "/v2/sessions") return Promise.resolve(new Response(JSON.stringify({ sequence: 0, sessions: [saved("closed", "2026-01-01T00:00:00.000Z", "closed")], bookmarks: [{ projectId: "project", sessionKey: { hostId: "project", piSessionId: "closed" }, position: 0 }] })));
      if (path === "/v2/projects/project" && init?.method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ projects: [], bookmarks: [] })));
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();
    client.connect();
    await vi.waitFor(() => expect(client.snapshot.connection).toBe("ready"));

    const requestId = client.removeProject("project");
    await vi.waitFor(() => expect(client.snapshot.projectRemovals[requestId!]?.status).toBe("succeeded"));

    expect(fetchMock).toHaveBeenCalledWith("/v2/projects/project", { method: "DELETE" });
    expect(client.snapshot.projects).toEqual([]);
    expect(client.snapshot.sessions).toEqual([]);
    expect(client.snapshot.projectBookmarks).toEqual([]);
    expect(client.snapshot.sessionBookmarks).toEqual([]);
  });

  it("shows the server reason when Project removal is unsafe", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ error: "Close all open or working Sessions before removing this Project (1 remaining)" }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();
    Object.assign(client.snapshot, { connection: "ready" });

    const requestId = client.removeProject("project");
    await vi.waitFor(() => expect(client.snapshot.projectRemovals[requestId!]?.status).toBe("failed"));
    expect(client.snapshot.projectRemovals[requestId!]?.error).toContain("Close all open or working Sessions");
  });

  it("uses settings and every Scheduled Job RPC method", async () => {
    const mutation = {
      title: "Review",
      prompt: "Review this Project",
      target: { type: "new-session" as const },
      schedule: { type: "recurring" as const, frequency: "daily" as const, localTime: "09:00" },
    };
    const responseJob = { id: "job-1" };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ settings: { timezone: "America/New_York" } }))
      .mockResolvedValueOnce(Response.json({ settings: { timezone: "Europe/London" } }))
      .mockResolvedValueOnce(Response.json({ jobs: [responseJob] }))
      .mockResolvedValueOnce(Response.json({ job: responseJob }))
      .mockResolvedValueOnce(Response.json({ job: responseJob }))
      .mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();

    await expect(client.getPiStationSettings()).resolves.toEqual({ timezone: "America/New_York" });
    await expect(client.setPiStationTimezone("Europe/London")).resolves.toEqual({ timezone: "Europe/London" });
    await expect(client.listScheduledJobs("project 1")).resolves.toEqual([responseJob]);
    await client.createScheduledJob("project 1", mutation);
    await client.updateScheduledJob("job/1", mutation);
    for (const action of ["pause", "resume", "run-now", "delete"] as const) {
      await client.scheduledJobAction("job/1", action);
    }

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/v2/settings", undefined],
      ["/v2/settings", "PUT"],
      ["/v2/scheduled-jobs?projectId=project%201", undefined],
      ["/v2/scheduled-jobs", "POST"],
      ["/v2/scheduled-jobs/job%2F1", "PUT"],
      ["/v2/scheduled-jobs/job%2F1/pause", "POST"],
      ["/v2/scheduled-jobs/job%2F1/resume", "POST"],
      ["/v2/scheduled-jobs/job%2F1/run-now", "POST"],
      ["/v2/scheduled-jobs/job%2F1", "DELETE"],
    ]);
  });

  it("persists a new Session before any turn occurs", async () => {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const persisted = { id: "persisted-session", projectId: "projectless-host", path: "/history/persisted.jsonl", cwd: "/work/new", name: "Directory Session", modifiedAt: "2026-01-01T00:00:00.000Z", state: "open" };
    const view = { version: 2, eventCursor: 0, session: persisted, phase: "idle", phaseGeneration: 0, timeline: [], historyRevision: "empty", hasEarlierHistory: false, settings: { modelInventory: [], supportedThinkingLevels: ["off"] }, sharedFiles: [] };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ project: { id: "projectless-host", root: "/work/new" } }))
      .mockResolvedValueOnce(Response.json({ session: persisted }))
      .mockResolvedValueOnce(Response.json(view));
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();

    const requestId = client.createManagedSession("/work/new", "Directory Session");
    expect(client.snapshot.managedSessionCreates[requestId]?.status).toBe("starting");
    await vi.waitFor(() => expect(client.snapshot.managedSessionCreates[requestId]?.status).toBe("succeeded"));

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/v2/session-hosts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ root: "/work/new" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/v2/projects/projectless-host/sessions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ cwd: "/work/new", name: "Directory Session" }),
    }));
    expect(client.snapshot.sessions[0]?.sessionKey.piSessionId).toBe("persisted-session");
    expect(client.snapshot.sessions[0]?.name).toBe("Directory Session");
    expect(client.snapshot.selectedSessionKey).toEqual({ hostId: "projectless-host", piSessionId: "persisted-session" });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/v2/projects/projectless-host/sessions/persisted-session", { cache: "no-store" });
  });

  it("uses the provider authentication protocol without putting secrets in URLs", async () => {
    const transaction = { id: "tx", providerId: "example", status: "running", events: [], expiresAt: "2026-01-01T00:00:00.000Z" };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ providers: [{ id: "example", name: "Example", configured: false, methods: [{ type: "api_key", name: "API key" }] }] }))
      .mockResolvedValueOnce(Response.json({ transaction }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ transaction }))
      .mockResolvedValueOnce(Response.json({ transaction: { ...transaction, prompt: undefined } }));
    globalThis.fetch = fetchMock;
    const client = new ApplicationClient();
    await client.getAuthProviders();
    await client.startProviderLogin("example", "api_key");
    await client.getAuthTransaction("tx");
    await client.answerAuthPrompt("tx", "private-key");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/v2/auth/login", expect.objectContaining({ method: "POST", body: JSON.stringify({ providerId: "example", type: "api_key" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/v2/auth/transactions/tx", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/v2/auth/transactions/tx/response", expect.objectContaining({ body: JSON.stringify({ value: "private-key" }) }));
    expect(fetchMock.mock.calls.map(([url]) => typeof url === "string" ? url : url instanceof URL ? url.href : url.url).join(" ")).not.toContain("private-key");
  });
});
