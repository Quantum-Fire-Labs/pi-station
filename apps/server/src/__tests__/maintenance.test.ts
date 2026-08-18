import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { MAINTENANCE_FILE, maintenanceIsActive } from "../maintenance.js"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pi-station-maintenance-"))
  directories.push(value)
  return value
}

describe("SDK maintenance marker", () => {
  it("is active for a current deployment marker", async () => {
    const dataDir = await directory()
    await writeFile(join(dataDir, MAINTENANCE_FILE), JSON.stringify({ startedAt: "2026-06-10T12:00:00.000Z", pid: process.pid }))

    await expect(maintenanceIsActive(dataDir, Date.parse("2026-06-10T12:10:00.000Z"))).resolves.toBe(true)
  })

  it("ignores missing, invalid, and stale markers", async () => {
    const dataDir = await directory()
    await expect(maintenanceIsActive(dataDir)).resolves.toBe(false)

    await writeFile(join(dataDir, MAINTENANCE_FILE), "not json")
    await expect(maintenanceIsActive(dataDir)).resolves.toBe(false)

    await writeFile(join(dataDir, MAINTENANCE_FILE), JSON.stringify({ startedAt: "2026-06-10T10:00:00.000Z", pid: process.pid }))
    await expect(maintenanceIsActive(dataDir, Date.parse("2026-06-10T12:00:00.000Z"))).resolves.toBe(false)
  })
})
