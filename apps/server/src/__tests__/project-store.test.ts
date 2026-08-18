import { mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ProjectStore } from "../project-store.js"

describe("ProjectStore names", () => {
  it("persists names on creation and rename without changing Project identity", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-station-project-names-"))
    const root = join(data, "project-root")
    await mkdir(root)
    const store = new ProjectStore(data)

    const created = await store.add(root, "Initial name")
    const project = created[0]!
    expect(project.name).toBe("Initial name")

    const renamed = await store.rename(project.id, "Renamed Project")
    expect(renamed[0]).toEqual({ ...project, name: "Renamed Project" })
    expect((await new ProjectStore(data).read())[0]).toEqual({ ...project, name: "Renamed Project" })
  })
})
