import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
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

  it("defaults existing records open and preserves reversible closed state", async () => {
    const data = await mkdtemp(join(tmpdir(), "pi-station-project-state-"))
    const root = join(data, "project-root")
    await mkdir(root)
    await writeFile(join(data, "projects.json"), JSON.stringify([{ id: "legacy", root, name: "Legacy" }]))
    const store = new ProjectStore(data)

    expect(await store.read()).toEqual([{ id: "legacy", root, name: "Legacy" }])
    expect(await store.setClosed("legacy", true)).toEqual([{ id: "legacy", root, name: "Legacy", closed: true }])
    expect((await store.rename("legacy", "Renamed"))[0]).toMatchObject({ closed: true, name: "Renamed" })
    await store.ensureOpen("legacy")
    expect(await new ProjectStore(data).read()).toEqual([{ id: "legacy", root, name: "Renamed" }])
  })
})
