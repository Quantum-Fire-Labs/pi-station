import { mkdirSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { resolveDataDirectory } from "../data-directory.js"

const temporaryDirectories: string[] = []
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function paths() {
  const parent = await mkdtemp(join(tmpdir(), "pi-station-data-migration-"))
  temporaryDirectories.push(parent)
  return { canonical: join(parent, "pi-station"), retired: join(parent, "pi-station-rpc-v2") }
}

describe("Pi Station data directory migration", () => {
  it("atomically renames the retired default when the canonical default is absent", async () => {
    const locations = await paths()
    mkdirSync(locations.retired)
    expect(resolveDataDirectory({}, locations)).toEqual({ path: locations.canonical, usedRetiredEnvironment: false, migratedRetiredDefault: true })
  })

  it("does not merge or replace an existing canonical directory", async () => {
    const locations = await paths()
    mkdirSync(locations.canonical)
    mkdirSync(locations.retired)
    expect(resolveDataDirectory({}, locations).migratedRetiredDefault).toBe(false)
  })

  it("gives the canonical variable priority and accepts the retired variable for one boundary", async () => {
    const locations = await paths()
    expect(resolveDataDirectory({ PI_STATION_DATA_DIR: locations.canonical, PI_STATION_RPC_V2_DATA_DIR: locations.retired }, locations).path).toBe(locations.canonical)
    expect(resolveDataDirectory({ PI_STATION_RPC_V2_DATA_DIR: locations.retired }, locations).usedRetiredEnvironment).toBe(true)
  })
})
