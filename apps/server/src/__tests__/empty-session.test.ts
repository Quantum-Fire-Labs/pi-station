import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it } from "vitest"
import { initializeEmptySession } from "../empty-session.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("empty Session initialization", () => {
  it("writes an indexable history before the first user turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-empty-session-"))
    const history = join(root, "history")
    roots.push(root)
    const manager = SessionManager.create(join(root, "project"), history, {
      id: "12345678-1234-4234-8234-123456789abc",
    })

    const sessionPath = initializeEmptySession(manager, "New Session")
    const entries = (await readFile(sessionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; customType?: string; name?: string })

    expect(entries[0]?.type).toBe("session")
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message" }),
      expect.objectContaining({ type: "custom", customType: "pi-station-empty-session" }),
      expect.objectContaining({ type: "session_info", name: "New Session" }),
    ]))
  })
})
