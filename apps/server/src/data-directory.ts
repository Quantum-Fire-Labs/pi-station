import { existsSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const DEFAULT_DATA_DIRECTORY = join(homedir(), ".local", "share", "pi-station")
export const RETIRED_DATA_DIRECTORY = join(homedir(), ".local", "share", "pi-station-rpc-v2")

export interface DataDirectoryResolution {
  readonly path: string
  readonly usedRetiredEnvironment: boolean
  readonly migratedRetiredDefault: boolean
}

/**
 * Select the canonical data directory. The rename is atomic because both default
 * directories have the same parent. A failed rename leaves the retired directory
 * unchanged, so an operator can start the previous release for rollback.
 */
export function resolveDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  paths = { canonical: DEFAULT_DATA_DIRECTORY, retired: RETIRED_DATA_DIRECTORY },
): DataDirectoryResolution {
  if (environment.PI_STATION_DATA_DIR !== undefined) {
    return { path: resolve(environment.PI_STATION_DATA_DIR), usedRetiredEnvironment: false, migratedRetiredDefault: false }
  }
  if (environment.PI_STATION_RPC_V2_DATA_DIR !== undefined) {
    return { path: resolve(environment.PI_STATION_RPC_V2_DATA_DIR), usedRetiredEnvironment: true, migratedRetiredDefault: false }
  }
  if (!existsSync(paths.canonical) && existsSync(paths.retired)) {
    renameSync(paths.retired, paths.canonical)
    return { path: resolve(paths.canonical), usedRetiredEnvironment: false, migratedRetiredDefault: true }
  }
  return { path: resolve(paths.canonical), usedRetiredEnvironment: false, migratedRetiredDefault: false }
}
