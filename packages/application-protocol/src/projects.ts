export interface Project {
  readonly id: string
  readonly root: string
  readonly name?: string
}

export function isProject(value: unknown): value is Project {
  if (!isExactRecord(value, ["id", "root", "name"])) return false
  return typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 200
    && typeof value.root === "string"
    && isAbsolutePath(value.root)
    && (value.name === undefined || isProjectName(value.name))
}

export function isProjectName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 120
    && value.trim() === value
    && [...value].every((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
}

export function isProjectList(value: unknown): value is readonly Project[] {
  return Array.isArray(value)
    && value.length <= 100
    && value.every(isProject)
    && new Set(value.map(({ id }) => id)).size === value.length
}

export function isProjectRootsRequest(value: unknown): value is { readonly roots: readonly string[] } {
  if (!isExactRecord(value, ["roots"]) || !Array.isArray(value.roots)) return false
  return value.roots.length <= 100
    && value.roots.every((root) => typeof root === "string" && isAbsolutePath(root))
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") && !value.includes("\0")
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.keys(value).every((key) => keys.includes(key))
}
