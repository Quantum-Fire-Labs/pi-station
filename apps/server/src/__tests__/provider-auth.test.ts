import { describe, expect, it, vi } from "vitest"
import type { AuthNotification, ProviderAuthType } from "@pi-station/application-protocol"
import { ProviderAuthError, ProviderAuthService, type ProviderAuthRuntime } from "../provider-auth.js"

const provider = { id: "example", name: "Example", auth: { apiKey: { name: "API key", login: true }, oauth: { name: "OAuth", loginLabel: "Sign in" } } }
function runtime(login: ProviderAuthRuntime["login"]): ProviderAuthRuntime {
  return { getProviders: () => [provider], checkAuth: vi.fn().mockResolvedValue(undefined), login, logout: vi.fn().mockResolvedValue(undefined) }
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe("ProviderAuthService", () => {
  it("lists only non-secret status and supported login methods", async () => {
    const checkAuth = vi.fn().mockResolvedValue({ type: "oauth" as const, source: "OAuth" })
    const value = runtime(vi.fn())
    value.checkAuth = checkAuth
    await expect(new ProviderAuthService(value).providers()).resolves.toEqual([{ id: "example", name: "Example", configured: true, configuredType: "oauth", source: "OAuth", methods: [{ type: "api_key", name: "API key" }, { type: "oauth", name: "Sign in" }] }])
  })

  it("bridges notifications and a single secret prompt without exposing its response", async () => {
    let notify: ((event: AuthNotification) => void) | undefined
    const login = vi.fn((_providerId: string, _type: ProviderAuthType, interaction: Parameters<ProviderAuthRuntime["login"]>[2]) => {
      notify = (event) => interaction.notify(event)
      return interaction.prompt({ type: "secret", message: "API key" }).then((value) => { expect(value).toBe("super-secret") })
    })
    const service = new ProviderAuthService(runtime(login))
    const started = service.start("example", "api_key")
    notify?.({ type: "progress", message: "Checking" })
    await settle()
    expect(service.transaction(started.id)).toMatchObject({ status: "running", events: [{ type: "progress", message: "Checking" }], prompt: { type: "secret", message: "API key" } })
    expect(() => service.start("example", "oauth")).toThrow(ProviderAuthError)
    const answered = service.respond(started.id, "super-secret")
    expect(JSON.stringify(answered)).not.toContain("super-secret")
    expect(answered.prompt).toBeUndefined()
    await settle()
    expect(service.transaction(started.id).status).toBe("succeeded")
  })

  it("cancels and expires pending prompts", async () => {
    let now = 100
    const login = (_id: string, _type: ProviderAuthType, interaction: Parameters<ProviderAuthRuntime["login"]>[2]) => interaction.prompt({ type: "manual_code", message: "Paste code" })
    const service = new ProviderAuthService(runtime(login), 50, () => now)
    const cancelled = service.start("example", "oauth")
    await settle()
    expect(service.cancel(cancelled.id).status).toBe("cancelled")
    expect(() => service.respond(cancelled.id, "late")).toThrow(ProviderAuthError)
    const expiring = service.start("example", "oauth")
    await settle(); now = 151
    expect(service.transaction(expiring.id)).toMatchObject({ status: "expired", error: "Authentication request expired" })
    expect(() => service.respond(expiring.id, "too late")).toThrow(ProviderAuthError)
  })

  it("logs out through the runtime and rejects unknown providers", async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    const value = runtime(vi.fn())
    value.logout = logout
    const service = new ProviderAuthService(value)
    await service.logout("example")
    expect(logout).toHaveBeenCalledOnce()
    expect(logout.mock.calls[0]?.[0]).toBe("example")
    await expect(service.logout("missing")).rejects.toMatchObject({ statusCode: 404 })
  })
})
