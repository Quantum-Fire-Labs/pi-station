import { realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { isProjectList } from "@pi-station/application-protocol"
import type { Project } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"
import { projectId } from "./domain.js"

type StoredProject = Project & { readonly closed?: boolean }

export class ProjectStore {
  readonly #store: AtomicJsonStore<readonly StoredProject[]>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "projects.json"), isStoredProjectList)
  }

  read(): Promise<readonly StoredProject[]> {
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

  setClosed(id: string, closed: boolean): Promise<readonly Project[]> {
    return this.#store.update([], (current) => {
      if (!current.some((project) => project.id === id)) throw new Error("Project is not configured")
      return current.map((project) => project.id === id
        ? closed ? { ...project, closed: true } : openProject(project)
        : project)
    })
  }

  async ensureOpen(id: string): Promise<void> {
    await this.#store.update([], (current) => current.some((project) => project.id === id && project.closed === true)
      ? current.map((project) => project.id === id ? openProject(project) : project)
      : current)
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
      return {
        id,
        root: canonical,
        ...(existing?.name === undefined ? {} : { name: existing.name }),
        ...(existing?.closed === true ? { closed: true } : {}),
      }
    }))

    const unique = [...new Map(configured.map((project) => [project.id, project])).values()]
    return this.#store.replace(unique)
  }
}

function openProject(project: StoredProject): StoredProject {
  return { id: project.id, root: project.root, ...(project.name === undefined ? {} : { name: project.name }) }
}

function isStoredProjectList(value: unknown): value is readonly StoredProject[] {
  if (!Array.isArray(value)) return false
  const legacyProjects: unknown[] = (value as unknown[]).map((project: unknown): unknown => {
    if (typeof project !== "object" || project === null || Array.isArray(project)) return project
    const record = project as Record<string, unknown>
    if (record.closed !== undefined && typeof record.closed !== "boolean") return project
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== "closed"))
  })
  return isProjectList(legacyProjects)
}
