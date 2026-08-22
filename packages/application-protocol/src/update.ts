export type UpdateChannel = "stable" | "edge"

export interface PiStationUpdateStatus {
  readonly channel: UpdateChannel
  readonly currentVersion: string
  readonly latestVersion?: string
  readonly updateAvailable: boolean
  readonly latestVersionError?: string
}

export interface UpdateChannelMutation {
  readonly channel: UpdateChannel
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "edge"
}

export function isUpdateChannelMutation(value: unknown): value is UpdateChannelMutation {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && isUpdateChannel((value as { readonly channel?: unknown }).channel)
}
