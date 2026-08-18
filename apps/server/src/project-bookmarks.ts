import { join } from "node:path"
import type { Project } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"

export interface ProjectBookmark {
  readonly projectId: string
  readonly position: number
}

export class ProjectBookmarkStore {
  readonly #store: AtomicJsonStore<readonly string[]>

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "project-bookmarks.json"), isProjectIds)
  }

  async list(projects: readonly Project[]): Promise<readonly ProjectBookmark[]> {
    const configured = new Set(projects.map((project) => project.id))
    return (await this.#store.read([]))
      .filter((id) => configured.has(id))
      .map((projectId, position) => ({ projectId, position }))
  }

  async set(projectId: string, bookmarked: boolean, projects: readonly Project[]): Promise<readonly ProjectBookmark[]> {
    if (!projects.some((project) => project.id === projectId)) throw new Error("Project is not configured")
    await this.#store.update([], (ids) => bookmarked
      ? ids.includes(projectId) ? ids : [...ids, projectId]
      : ids.filter((id) => id !== projectId))
    return this.list(projects)
  }

  async removeProject(projectId: string): Promise<void> {
    await this.#store.update([], (ids) => ids.filter((id) => id !== projectId))
  }

  async reorder(projectId: string, direction: "up" | "down", projects: readonly Project[]): Promise<readonly ProjectBookmark[]> {
    await this.#store.update([], (ids) => {
      const index = ids.indexOf(projectId)
      if (index < 0) return ids
      const target = direction === "up" ? index - 1 : index + 1
      if (target < 0 || target >= ids.length) return ids
      const next = [...ids]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
    return this.list(projects)
  }
}

function isProjectIds(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") && new Set(value).size === value.length
}
