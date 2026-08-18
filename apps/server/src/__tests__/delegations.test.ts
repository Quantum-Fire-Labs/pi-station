import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DelegationStore, type DelegationRecord } from "../delegations.js"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe("DelegationStore", () => {
  it("persists the parent, child, order, and lifecycle state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-delegations-"))
    roots.push(root)
    const store = new DelegationStore(root)
    const record: DelegationRecord = {
      id: "delegation-1", projectId: "project-1", parentSessionId: "parent-1",
      childSessionId: "child-1", childPath: "/sessions/child-1.jsonl", name: "Audit",
      status: "working", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }
    await store.put(record)
    await store.put({ ...record, status: "completed", updatedAt: "2026-01-01T00:01:00.000Z" })

    await expect(store.list()).resolves.toEqual([{ ...record, status: "completed", updatedAt: "2026-01-01T00:01:00.000Z" }])
    expect((await store.byChild()).get("child-1")?.parentSessionId).toBe("parent-1")
    await expect(store.directChild({ projectId: "project-1", parentSessionId: "parent-1", childSessionId: "child-1" }))
      .resolves.toEqual(expect.objectContaining({ id: "delegation-1" }))
    await expect(store.directChild({ projectId: "project-1", parentSessionId: "other-parent", childSessionId: "child-1" }))
      .resolves.toBeUndefined()
  })

  it("marks Working delegations as interrupted without changing their identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-delegations-"))
    roots.push(root)
    const store = new DelegationStore(root)
    const record: DelegationRecord = {
      id: "delegation-1", projectId: "project-1", parentSessionId: "parent-1",
      childSessionId: "child-1", childPath: "/worktree/sessions/child-1.jsonl",
      status: "working", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }
    await store.put(record)

    const interrupted = await store.interruptWorking()

    expect(interrupted).toEqual([expect.objectContaining({ id: "delegation-1", status: "interrupted" })])
    await expect(store.interruptWorking()).resolves.toEqual([])
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        id: "delegation-1", projectId: "project-1", parentSessionId: "parent-1",
        childSessionId: "child-1", childPath: "/worktree/sessions/child-1.jsonl", status: "interrupted",
      }),
    ])
  })
})
