import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionRuntime } from "../session-runtime.js"
import type { SessionIndex } from "../domain.js"
import { createPiStationServer } from "../server.js"
import { SessionDefaultsStore } from "../session-defaults.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const index: SessionIndex = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(undefined),
  indexSession: (session) => Promise.resolve(session),
  refreshSession: () => Promise.resolve(undefined),
  timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
  timelineImage: () => Promise.resolve(undefined),
  rename: (session, name) => Promise.resolve({ ...session, name }),
}

const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime

async function withServer(dataDir: string, test: (base: string) => Promise<void>): Promise<void> {
  const server = createPiStationServer({
    dataDir,
    index,
    runner,
    sessionDefaultModels: () => [
      { provider: "openai-codex", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
      { provider: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
    ],
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("No address")
  try {
    await test(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe("Pi Station Session defaults", () => {
  it("repairs the legacy unauthenticated OpenAI default provider", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-session-defaults-"))
    roots.push(dataDir)
    const path = join(dataDir, "session-defaults.json")
    await writeFile(path, JSON.stringify({ provider: "openai", modelId: "gpt-5.6-sol", thinkingLevel: "high" }))

    await expect(new SessionDefaultsStore(dataDir).read()).resolves.toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.6-sol",
      thinkingLevel: "high",
    })
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ provider: "openai-codex" })
  })

  it("loads defaults, saves valid values, rejects invalid values, and persists the saved values", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-session-defaults-"))
    roots.push(dataDir)
    const saved = { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "high" }

    await withServer(dataDir, async (base) => {
      const initial = await fetch(`${base}/v2/session-defaults`)
      expect(initial.status).toBe(200)
      await expect(initial.json()).resolves.toMatchObject({
        defaults: { provider: "openai-codex", modelId: "gpt-5.6-sol", thinkingLevel: "medium" },
        models: [
          { provider: "openai-codex", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
          { provider: "anthropic", modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
        ],
      })

      const changed = await fetch(`${base}/v2/session-defaults`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saved),
      })
      expect(changed.status).toBe(200)
      await expect(changed.json()).resolves.toMatchObject({ defaults: saved })

      const invalid = await fetch(`${base}/v2/session-defaults`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...saved, thinkingLevel: "extreme" }),
      })
      expect(invalid.status).toBe(400)

      const unavailable = await fetch(`${base}/v2/session-defaults`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...saved, provider: "openai", modelId: "gpt-missing" }),
      })
      expect(unavailable.status).toBe(400)
    })

    await withServer(dataDir, async (base) => {
      await expect((await fetch(`${base}/v2/session-defaults`)).json()).resolves.toMatchObject({ defaults: saved })
    })
  })
})
