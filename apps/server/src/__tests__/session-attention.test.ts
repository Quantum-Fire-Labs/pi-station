import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SessionAttentionStore } from "../session-attention.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function store(): Promise<SessionAttentionStore> {
  const root = await mkdtemp(join(tmpdir(), "pi-station-attention-"))
  roots.push(root)
  return new SessionAttentionStore(root, () => new Date("2026-01-01T00:00:00.000Z"))
}

const key = { projectId: "project", sessionId: "session" }

describe("Session attention state", () => {
  it("keeps attention, Working, and read state independent", async () => {
    const attention = await store()
    expect(await attention.record(key, "turn-1")).toBe(true)
    expect(await attention.record(key, "turn-1")).toBe(false)
    expect(await attention.unread(key)).toEqual({ hasUnread: true, latestAttentionId: "turn-1" })

    const decorated = await attention.decorate([{
      id: key.sessionId,
      projectId: key.projectId,
      path: "/session.jsonl",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      state: "open" as const,
    }])
    expect(decorated[0]?.unread).toEqual({ hasUnread: true, latestAttentionId: "turn-1" })
    expect(decorated[0]?.state).toBe("open")
  })

  it("keeps delegated child attention until that child is read", async () => {
    const attention = await store()
    const sessions = [
      { id: "parent", projectId: "project" },
      { id: "working-child", projectId: "project", parentSessionId: "parent", delegationStatus: "working" },
      { id: "completed-child", projectId: "project", parentSessionId: "parent", delegationStatus: "completed" },
      { id: "nested-child", projectId: "project", parentSessionId: "working-child", delegationStatus: "completed" },
      { id: "former-child", projectId: "project" },
    ] as const
    for (const session of sessions) {
      await attention.record({ projectId: session.projectId, sessionId: session.id }, `attention-${session.id}`)
    }

    const decorated = await attention.decorate(sessions)
    expect(decorated.map((session) => [session.id, session.unread])).toEqual([
      ["parent", { hasUnread: true, latestAttentionId: "attention-parent" }],
      ["working-child", { hasUnread: true, latestAttentionId: "attention-working-child" }],
      ["completed-child", { hasUnread: true, latestAttentionId: "attention-completed-child" }],
      ["nested-child", { hasUnread: true, latestAttentionId: "attention-nested-child" }],
      ["former-child", { hasUnread: true, latestAttentionId: "attention-former-child" }],
    ])

    await attention.markRead({ projectId: "project", sessionId: "parent" }, "attention-parent")
    await expect(attention.unread({ projectId: "project", sessionId: "completed-child" })).resolves.toEqual({
      hasUnread: true,
      latestAttentionId: "attention-completed-child",
    })
    await attention.markRead({ projectId: "project", sessionId: "completed-child" }, "attention-completed-child")
    await expect(attention.unread({ projectId: "project", sessionId: "completed-child" })).resolves.toEqual({ hasUnread: false })
  })

  it("persists only SessionKey fields and keeps the record readable", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-attention-"))
    roots.push(root)
    const attention = new SessionAttentionStore(root, () => new Date("2026-01-01T00:00:00.000Z"))
    const extendedKey = { ...key, id: "attention-1", kind: "permission", text: "Approval needed" }

    await attention.record(extendedKey, extendedKey.id)

    expect(JSON.parse(await readFile(join(root, "session-attention.json"), "utf8"))).toEqual({
      version: 1,
      records: [{
        sessionId: key.sessionId,
        latestAttentionId: extendedKey.id,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    })
    await expect(new SessionAttentionStore(root).unread(key)).resolves.toEqual({
      hasUnread: true,
      latestAttentionId: extendedKey.id,
    })
  })

  it("does not let a stale read clear newer attention", async () => {
    const attention = await store()
    await attention.record(key, "turn-1")
    await attention.record(key, "turn-2")
    await expect(attention.markRead(key, "turn-1")).resolves.toBeUndefined()
    expect(await attention.unread(key)).toEqual({ hasUnread: true, latestAttentionId: "turn-2" })
    await expect(attention.markRead(key, "turn-2")).resolves.toEqual({ hasUnread: false })
    expect(await attention.unread(key)).toEqual({ hasUnread: false })
  })
})
