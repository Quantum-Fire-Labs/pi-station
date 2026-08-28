import { describe, expect, it } from "vitest";
import type { SessionSummary } from "./application/workspace-model";
import {
  findDeepLinkedSession,
  sessionDeepLinkTarget,
  urlAfterConsumingSessionDeepLink,
} from "./session-deep-links";

const session = (projectId: string, sessionId: string, hostId = projectId): SessionSummary => ({
  projectId,
  sessionKey: { hostId, piSessionId: sessionId },
  projection: {
    availability: "available",
    synchronization: "synchronized",
    run: "idle",
    queue: { state: "empty", knownCount: 0 },
    unread: { hasUnread: false },
    management: { kind: "unmanaged" },
    capabilities: [],
  },
});

describe("session deep links", () => {
  it("reads encoded public project and session selectors", () => {
    expect(sessionDeepLinkTarget("?project=project%2Fone&session=session%20two")).toEqual({
      projectId: "project/one",
      sessionId: "session two",
    });
  });

  it("accepts legacy notification selectors", () => {
    expect(sessionDeepLinkTarget("?hostId=host&piSessionId=session")).toEqual({
      projectId: "host",
      sessionId: "session",
    });
  });

  it("prefers public selectors and requires a session", () => {
    expect(sessionDeepLinkTarget("?project=new&session=target&hostId=old&piSessionId=other")).toEqual({
      projectId: "new",
      sessionId: "target",
    });
    expect(sessionDeepLinkTarget("?project=project")).toBeUndefined();
  });

  it("uses the project selector to disambiguate sessions", () => {
    const sessions = [session("alpha", "same"), session("beta", "same")];
    expect(findDeepLinkedSession(sessions, { projectId: "beta", sessionId: "same" })?.projectId).toBe("beta");
  });

  it("matches transient hosts when project metadata is absent or different", () => {
    const target = session("configured-project", "target", "transient-host");
    expect(findDeepLinkedSession([target], { projectId: "transient-host", sessionId: "target" })).toBe(target);
  });

  it("preserves subpaths, unrelated parameters, and hashes after consumption", () => {
    const url = new URL("https://station.example/workspace/base/?theme=dark&project=p&session=s#composer");
    expect(urlAfterConsumingSessionDeepLink(url)).toBe("/workspace/base/?theme=dark#composer");
  });

  it("removes both public and legacy selector forms", () => {
    const url = new URL("https://station.example/workspace?project=p&session=s&hostId=h&piSessionId=i");
    expect(urlAfterConsumingSessionDeepLink(url)).toBe("/workspace");
  });
});
