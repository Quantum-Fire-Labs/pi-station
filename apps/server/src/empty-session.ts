import type { SessionManager } from "@earendil-works/pi-coding-agent"

export function initializeEmptySession(manager: SessionManager, name?: string): string {
  manager.appendMessage({
    role: "assistant",
    content: [],
    api: "pi-station",
    provider: "pi-station",
    model: "empty-session",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  })
  manager.appendCustomEntry("pi-station-empty-session")
  if (name !== undefined) manager.appendSessionInfo(name)
  const sessionPath = manager.getSessionFile()
  if (sessionPath === undefined) throw new Error("Empty Session history was not written")
  return sessionPath
}
