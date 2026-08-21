export type ProviderAuthType = "api_key" | "oauth"

export interface ProviderAuthMethod {
  readonly type: ProviderAuthType
  readonly name: string
}

export interface ProviderAuthStatus {
  readonly id: string
  readonly name: string
  readonly configured: boolean
  readonly configuredType?: ProviderAuthType
  readonly source?: string
  readonly methods: readonly ProviderAuthMethod[]
}

export interface AuthSelectOption { readonly id: string; readonly label: string; readonly description?: string }
export type AuthPromptView =
  | { readonly type: "text" | "secret" | "manual_code"; readonly message: string; readonly placeholder?: string }
  | { readonly type: "select"; readonly message: string; readonly options: readonly AuthSelectOption[] }
export type AuthNotification =
  | { readonly type: "info"; readonly message: string; readonly links?: readonly { readonly url: string; readonly label?: string }[] }
  | { readonly type: "auth_url"; readonly url: string; readonly instructions?: string }
  | { readonly type: "device_code"; readonly userCode: string; readonly verificationUri: string; readonly intervalSeconds?: number; readonly expiresInSeconds?: number }
  | { readonly type: "progress"; readonly message: string }
export interface AuthTransaction {
  readonly id: string
  readonly providerId: string
  readonly status: "running" | "succeeded" | "failed" | "cancelled" | "expired"
  readonly events: readonly AuthNotification[]
  readonly prompt?: AuthPromptView
  readonly error?: string
  readonly expiresAt: string
}

const record = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key))
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 100 && /^[a-zA-Z0-9._-]+$/.test(value)
export function isAuthLoginRequest(value: unknown): value is { readonly providerId: string; readonly type: ProviderAuthType } {
  const input = record(value)
  return input !== undefined && exact(input, ["providerId", "type"]) && identifier(input.providerId) && (input.type === "api_key" || input.type === "oauth")
}
export function isAuthPromptResponse(value: unknown): value is { readonly value: string } {
  const input = record(value)
  return input !== undefined && exact(input, ["value"]) && typeof input.value === "string" && input.value.length <= 20_000
}
