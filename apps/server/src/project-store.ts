import { realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { isProjectList } from "@pi-station/application-protocol"
import type { Project } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"
import { projectId } from "./domain.js"

export class ProjectStore {
  readonly #store: AtomicJsonStore<readonly Project[]>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "projects.json"), isProjectList)
  }

  read(): Promise<readonly Project[]> {
    return this.#store.read([])
  }

  async add(root: string, name: string): Promise<readonly Project[]> {
    const current = await this.read()
    const configured = await this.configure([...current.map((project) => project.root), root])
    const added = configured.find((project) => !current.some((existing) => existing.id === project.id))
    if (added === undefined) throw new Error("Project is already configured")
    return this.#store.replace(configured.map((project) => project.id === added.id ? { ...project, name } : project))
  }

  async rename(id: string, name: string): Promise<readonly Project[]> {
    const current = await this.read()
    if (!current.some((project) => project.id === id)) throw new Error("Project is not configured")
    return this.#store.replace(current.map((project) => project.id === id ? { ...project, name } : project))
  }

  async remove(id: string): Promise<readonly Project[]> {
    const current = await this.read()
    if (!current.some((project) => project.id === id)) throw new Error("Project is not configured")
    return this.#store.replace(current.filter((project) => project.id !== id))
  }

  async configure(roots: readonly string[]): Promise<readonly Project[]> {
    const current = await this.read()
    const configured = await Promise.all(roots.map(async (root) => {
      const canonical = await realpath(root)
      if (!(await stat(canonical)).isDirectory()) {
        throw new Error("Project root must be a directory")
      }
      const id = projectId(canonical)
      const existing = current.find((project) => project.id === id)
      return { id, root: canonical, ...(existing?.name === undefined ? {} : { name: existing.name }) }
    }))

    const unique = [...new Map(configured.map((project) => [project.id, project])).values()]
    return this.#store.replace(unique)
  }
}
