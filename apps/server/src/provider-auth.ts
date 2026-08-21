import { randomUUID } from "node:crypto"
import type { AuthNotification, AuthPromptView, AuthTransaction, ProviderAuthStatus, ProviderAuthType } from "@pi-station/application-protocol"

type SdkAuthPrompt = AuthPromptView & { readonly signal?: AbortSignal }
interface SdkAuthInteraction { readonly signal?: AbortSignal; prompt(prompt: SdkAuthPrompt): Promise<string>; notify(event: AuthNotification): void }
interface RuntimeProvider {
  readonly id: string
  readonly name: string
  readonly auth: {
    readonly apiKey?: { readonly name: string; readonly login?: unknown }
    readonly oauth?: { readonly name: string; readonly loginLabel?: string }
  }
}
export interface ProviderAuthRuntime {
  getProviders(): readonly RuntimeProvider[]
  checkAuth(providerId: string, options?: { signal?: AbortSignal }): Promise<{ readonly type: ProviderAuthType; readonly source?: string } | undefined>
  login(providerId: string, type: ProviderAuthType, interaction: SdkAuthInteraction): Promise<unknown>
  logout(providerId: string, options?: { signal?: AbortSignal }): Promise<void>
}

interface MutableTransaction {
  readonly id: string
  readonly providerId: string
  status: AuthTransaction["status"]
  readonly events: AuthNotification[]
  prompt: AuthPromptView | undefined
  error: string | undefined
  readonly expiresAt: number
  readonly abort: AbortController
  pending: { readonly resolve: (value: string) => void; readonly reject: (error: Error) => void; readonly cleanup: () => void } | undefined
}

export class ProviderAuthError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}

const CANCELLED = "Authentication cancelled"
const EXPIRED = "Authentication request expired"

export class ProviderAuthService {
  readonly #transactions = new Map<string, MutableTransaction>()
  constructor(private readonly runtime: ProviderAuthRuntime, private readonly ttlMs = 10 * 60_000, private readonly now = () => Date.now()) {}

  async providers(): Promise<readonly ProviderAuthStatus[]> {
    return Promise.all(this.runtime.getProviders().map(async (provider): Promise<ProviderAuthStatus> => {
      const methods = [
        ...(provider.auth.apiKey?.login === undefined ? [] : [{ type: "api_key" as const, name: provider.auth.apiKey.name }]),
        ...(provider.auth.oauth === undefined ? [] : [{ type: "oauth" as const, name: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name }]),
      ]
      const auth = await this.runtime.checkAuth(provider.id, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
      return { id: provider.id, name: provider.name, configured: auth !== undefined, ...(auth === undefined ? {} : { configuredType: auth.type, ...(auth.source === undefined ? {} : { source: auth.source }) }), methods }
    }))
  }

  start(providerId: string, type: ProviderAuthType): AuthTransaction {
    const provider = this.runtime.getProviders().find(({ id }) => id === providerId)
    const supported = type === "api_key" ? provider?.auth.apiKey?.login !== undefined : provider?.auth.oauth !== undefined
    if (!supported) throw new ProviderAuthError(400, "Provider or authentication method is not supported")
    for (const item of this.#transactions.values()) {
      if (item.status === "running" && item.expiresAt <= this.now()) this.#expire(item)
    }
    const active = [...this.#transactions.values()].find((item) => item.providerId === providerId && item.status === "running")
    if (active !== undefined) this.#cancel(active, "Authentication replaced by a new attempt")
    const transaction: MutableTransaction = { id: randomUUID(), providerId, status: "running", events: [], prompt: undefined, error: undefined, pending: undefined, expiresAt: this.now() + this.ttlMs, abort: new AbortController() }
    this.#transactions.set(transaction.id, transaction)
    const timer = setTimeout(() => {
      if (transaction.status === "running") {
        this.#expire(transaction)
        const removal = setTimeout(() => this.#transactions.delete(transaction.id), 60_000)
        removal.unref()
      } else this.#transactions.delete(transaction.id)
    }, this.ttlMs)
    timer.unref()
    void this.runtime.login(providerId, type, {
      signal: transaction.abort.signal,
      notify: (event) => { if (transaction.status === "running") { transaction.events.push(structuredClone(event)); if (transaction.events.length > 100) transaction.events.shift() } },
      prompt: (prompt) => this.#prompt(transaction, prompt),
    }).then(() => {
      if (transaction.status === "running") transaction.status = "succeeded"
    }).catch(() => {
      if (transaction.status === "running") { transaction.status = "failed"; transaction.error = "Authentication failed. Check the details and try again." }
    }).finally(() => { this.#rejectPending(transaction, CANCELLED) })
    return this.#public(transaction)
  }

  transaction(id: string): AuthTransaction {
    const transaction = this.#find(id)
    if (transaction.status === "running" && transaction.expiresAt <= this.now()) this.#expire(transaction)
    return this.#public(transaction)
  }

  respond(id: string, value: string): AuthTransaction {
    const transaction = this.#find(id)
    if (transaction.status === "running" && transaction.expiresAt <= this.now()) this.#expire(transaction)
    if (transaction.status !== "running" || transaction.pending === undefined) throw new ProviderAuthError(409, "No authentication prompt is waiting for a response")
    const pending = transaction.pending
    transaction.pending = undefined
    transaction.prompt = undefined
    pending.cleanup()
    pending.resolve(value)
    return this.#public(transaction)
  }

  cancel(id: string): AuthTransaction {
    const transaction = this.#find(id)
    if (transaction.status === "running" && transaction.expiresAt <= this.now()) this.#expire(transaction)
    if (transaction.status === "running") this.#cancel(transaction, CANCELLED)
    return this.#public(transaction)
  }

  async logout(providerId: string): Promise<void> {
    if (!this.runtime.getProviders().some(({ id }) => id === providerId)) throw new ProviderAuthError(404, "Provider was not found")
    await this.runtime.logout(providerId, { signal: AbortSignal.timeout(15_000) })
  }

  #prompt(transaction: MutableTransaction, prompt: SdkAuthPrompt): Promise<string> {
    if (transaction.status !== "running" || transaction.abort.signal.aborted) return Promise.reject(new Error(CANCELLED))
    if (transaction.pending !== undefined) return Promise.reject(new Error("Provider requested more than one prompt at a time"))
    const promptSignal = prompt.signal
    const publicPrompt: AuthPromptView = prompt.type === "select"
      ? { type: "select", message: prompt.message, options: structuredClone(prompt.options) }
      : { type: prompt.type, message: prompt.message, ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }) }
    transaction.prompt = publicPrompt
    return new Promise<string>((resolve, reject) => {
      const abort = (): void => {
        if (transaction.pending?.reject !== reject) return
        transaction.pending = undefined
        transaction.prompt = undefined
        cleanup()
        reject(new Error(CANCELLED))
      }
      const cleanup = (): void => promptSignal?.removeEventListener("abort", abort)
      transaction.pending = { resolve, reject, cleanup }
      promptSignal?.addEventListener("abort", abort, { once: true })
      if (promptSignal?.aborted) abort()
    })
  }

  #cancel(transaction: MutableTransaction, message: string): void {
    if (transaction.status !== "running") return
    transaction.status = "cancelled"
    transaction.error = message
    transaction.abort.abort(new Error(message))
    this.#rejectPending(transaction, message)
  }
  #expire(transaction: MutableTransaction): void {
    if (transaction.status !== "running") return
    transaction.status = "expired"
    transaction.error = EXPIRED
    transaction.abort.abort()
    this.#rejectPending(transaction, EXPIRED)
  }
  #rejectPending(transaction: MutableTransaction, message: string): void {
    const pending = transaction.pending
    transaction.pending = undefined
    transaction.prompt = undefined
    if (pending !== undefined) { pending.cleanup(); pending.reject(new Error(message)) }
  }
  #find(id: string): MutableTransaction {
    const transaction = this.#transactions.get(id)
    if (transaction === undefined) throw new ProviderAuthError(404, "Authentication request was not found")
    return transaction
  }
  #public(transaction: MutableTransaction): AuthTransaction {
    return { id: transaction.id, providerId: transaction.providerId, status: transaction.status, events: structuredClone(transaction.events), ...(transaction.prompt === undefined ? {} : { prompt: structuredClone(transaction.prompt) }), ...(transaction.error === undefined ? {} : { error: transaction.error }), expiresAt: new Date(transaction.expiresAt).toISOString() }
  }
}
