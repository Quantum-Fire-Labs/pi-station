import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionIndex } from "../domain.js"
import type { SessionRuntime } from "../session-runtime.js"
import { ProviderAuthService, type ProviderAuthRuntime } from "../provider-auth.js"
import { createPiStationServer } from "../server.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("provider auth routes", () => {
  it("protects mutations and bridges login, prompt response, status, and logout", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-auth-routes-")); roots.push(dataDir)
    let configured = false
    const logout = vi.fn(() => { configured = false; return Promise.resolve() })
    const runtime: ProviderAuthRuntime = {
      getProviders: () => [{ id: "example", name: "Example", auth: { apiKey: { name: "API key", login: true } } }],
      checkAuth: () => Promise.resolve(configured ? { type: "api_key", source: "stored" } : undefined),
      login: (_id, _type, interaction) => { interaction.notify({ type: "info", message: "Enter a key" }); return interaction.prompt({ type: "secret", message: "Key" }).then(() => { configured = true }) },
      logout,
    }
    const index = { list: () => Promise.resolve([]), get: () => Promise.resolve(undefined), indexSession: vi.fn(), refreshSession: vi.fn(), timeline: () => Promise.resolve([]), historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }), rename: vi.fn() } as unknown as SessionIndex
    const runner = { run: vi.fn(), control: vi.fn(), interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
    const server = createPiStationServer({ dataDir, index, runner, providerAuth: new ProviderAuthService(runtime) })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address(); if (address === null || typeof address === "string") throw new Error("No address")
    const base = `http://127.0.0.1:${address.port}`
    try {
      const providers = await fetch(`${base}/v2/auth/providers`)
      expect(await providers.json()).toMatchObject({ providers: [{ id: "example", configured: false, methods: [{ type: "api_key" }] }] })
      const blocked = await fetch(`${base}/v2/auth/login`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ providerId: "example", type: "api_key" }) })
      expect(blocked.status).toBe(403)
      const wrongType = await fetch(`${base}/v2/auth/login`, { method: "POST", body: JSON.stringify({ providerId: "example", type: "api_key" }) })
      expect(wrongType.status).toBe(415)
      const login = await fetch(`${base}/v2/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: "example", type: "api_key" }) })
      const loginBody = await login.json() as { transaction: { id: string } }; expect(login.status).toBe(202)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const pending = await (await fetch(`${base}/v2/auth/transactions/${loginBody.transaction.id}`)).json() as { transaction: unknown }
      expect(pending).toMatchObject({ transaction: { prompt: { type: "secret" }, events: [{ type: "info" }] } })
      const response = await fetch(`${base}/v2/auth/transactions/${loginBody.transaction.id}/response`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "do-not-return" }) })
      expect(JSON.stringify(await response.json())).not.toContain("do-not-return")
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(await (await fetch(`${base}/v2/auth/transactions/${loginBody.transaction.id}`)).json()).toMatchObject({ transaction: { status: "succeeded" } })
      expect((await fetch(`${base}/v2/auth/providers/example`, { method: "DELETE" })).status).toBe(200)
      expect(logout).toHaveBeenCalled()
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })
})
