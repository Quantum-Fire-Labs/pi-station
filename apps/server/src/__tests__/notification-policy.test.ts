import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DelegationStore, type DelegationRecord } from "../delegations.js"
import { allowsDirectNotification } from "../notification-policy.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const record = (id: string, parentSessionId: string, childSessionId: string, status: DelegationRecord["status"] = "completed"): DelegationRecord => ({
  id,
  projectId: "project",
  parentSessionId,
  childSessionId,
  childPath: `/sessions/${childSessionId}.jsonl`,
  status,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:01:00.000Z",
})

async function store(): Promise<{ root: string; delegations: DelegationStore }> {
  const root = await mkdtemp(join(tmpdir(), "pi-station-notification-policy-"))
  roots.push(root)
  return { root, delegations: new DelegationStore(root) }
}

describe("delegated Session notification policy", () => {
  it("suppresses direct notifications for active, completed, failed, and nested children", async () => {
    const { delegations } = await store()
    await delegations.put(record("one", "parent", "working-child", "working"))
    await delegations.put(record("two", "parent", "completed-child"))
    await delegations.put(record("three", "parent", "failed-child", "failed"))
    await delegations.put(record("four", "completed-child", "nested-child"))

    for (const sessionId of ["working-child", "completed-child", "failed-child", "nested-child"]) {
      await expect(allowsDirectNotification({ projectId: "project", sessionId }, delegations)).resolves.toBe(false)
    }
  })

  it("uses stored relationships after startup or reconnect and allows parents and non-delegated Sessions", async () => {
    const { root, delegations } = await store()
    await delegations.put(record("one", "parent", "child", "interrupted"))
    const reconnected = new DelegationStore(root)

    await expect(allowsDirectNotification({ projectId: "project", sessionId: "child" }, reconnected)).resolves.toBe(false)
    await expect(allowsDirectNotification({ projectId: "project", sessionId: "parent" }, reconnected)).resolves.toBe(true)
    await expect(allowsDirectNotification({ projectId: "project", sessionId: "ordinary" }, reconnected)).resolves.toBe(true)
    await expect(allowsDirectNotification({ projectId: "other-project", sessionId: "child" }, reconnected)).resolves.toBe(false)
  })
})
