import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const MAINTENANCE_FILE = "maintenance.json"
const MAX_MAINTENANCE_AGE_MS = 60 * 60 * 1_000
const MAX_CLOCK_SKEW_MS = 60_000

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function maintenanceIsActive(dataDir: string, now = Date.now()): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(dataDir, MAINTENANCE_FILE), "utf8")) as {
      pid?: unknown
      startedAt?: unknown
    }
    if (typeof value.startedAt !== "string" || typeof value.pid !== "number" || !Number.isSafeInteger(value.pid) || value.pid < 1) return false
    const startedAt = Date.parse(value.startedAt)
    return Number.isFinite(startedAt)
      && startedAt <= now + MAX_CLOCK_SKEW_MS
      && now - startedAt < MAX_MAINTENANCE_AGE_MS
      && processExists(value.pid)
  } catch {
    return false
  }
}
