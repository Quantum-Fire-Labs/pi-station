import type { SessionSummary } from "./application/workspace-model";

export interface SessionDeepLinkTarget {
  readonly projectId?: string;
  readonly sessionId: string;
}

/**
 * Reads the public project/session selectors and the legacy notification
 * hostId/piSessionId selectors. Public selectors take precedence.
 */
export function sessionDeepLinkTarget(search: string): SessionDeepLinkTarget | undefined {
  const parameters = new URLSearchParams(search);
  const sessionId = parameters.get("session") ?? parameters.get("piSessionId");
  if (!sessionId) return undefined;
  const projectId = parameters.get("project") ?? parameters.get("hostId") ?? undefined;
  return { sessionId, ...(projectId ? { projectId } : {}) };
}

export function findDeepLinkedSession(
  sessions: readonly SessionSummary[],
  target: SessionDeepLinkTarget,
): SessionSummary | undefined {
  const matches = sessions.filter((session) => session.sessionKey.piSessionId === target.sessionId
    && (target.projectId === undefined
      || session.projectId === target.projectId
      || session.sessionKey.hostId === target.projectId));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Removes only Pi Station's consumed selectors, preserving the deployment path,
 * unrelated query parameters, and hash. */
export function urlAfterConsumingSessionDeepLink(url: URL): string {
  const parameters = new URLSearchParams(url.search);
  for (const name of ["project", "session", "hostId", "piSessionId"]) parameters.delete(name);
  const search = parameters.size === 0 ? "" : `?${parameters.toString()}`;
  return `${url.pathname}${search}${url.hash}`;
}
