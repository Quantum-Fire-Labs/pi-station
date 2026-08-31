import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import type { InlineExtension } from "@earendil-works/pi-coding-agent"

export interface LocalAgentsFile {
  readonly path: string
  readonly content: string
}

const LOCAL_AGENTS_FILENAME = "AGENTS.local.md"
const OVERRIDE_AGENTS_FILENAME = "AGENTS.override.md"

function canonicalizePath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function hasAgentsOverride(directory: string): boolean {
  const path = join(directory, OVERRIDE_AGENTS_FILENAME)
  if (!existsSync(path)) return false
  try {
    return statSync(path).isFile()
  } catch (error) {
    console.warn(`Could not inspect ${path}; suppressing ${LOCAL_AGENTS_FILENAME}`, error)
    return true
  }
}

function loadLocalAgentsFile(directory: string): LocalAgentsFile | undefined {
  if (hasAgentsOverride(directory)) return undefined
  const path = join(directory, LOCAL_AGENTS_FILENAME)
  if (!existsSync(path)) return undefined
  try {
    if (!statSync(path).isFile()) return undefined
    return { path, content: readFileSync(path, "utf8").replace(/^\uFEFF/u, "") }
  } catch (error) {
    console.warn(`Could not load ${path}`, error)
    return undefined
  }
}

interface GitPaths {
  readonly repoDir: string
  readonly commonGitDir: string
}

function findGitPaths(cwd: string): GitPaths | undefined {
  let directory = cwd
  while (true) {
    const dotGit = join(directory, ".git")
    if (existsSync(dotGit)) {
      try {
        const stats = statSync(dotGit)
        if (stats.isDirectory()) {
          if (!existsSync(join(dotGit, "HEAD"))) return undefined
          return { repoDir: directory, commonGitDir: dotGit }
        }
        if (stats.isFile()) {
          const contents = readFileSync(dotGit, "utf8").trim()
          if (!contents.startsWith("gitdir: ")) return undefined
          const gitDir = resolve(directory, contents.slice(8).trim())
          if (!existsSync(join(gitDir, "HEAD"))) return undefined
          const commonDirPath = join(gitDir, "commondir")
          const commonGitDir = existsSync(commonDirPath)
            ? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
            : gitDir
          return { repoDir: directory, commonGitDir }
        }
      } catch {
        return undefined
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

function findShadowedLocalAgentsFile(cwd: string): string | undefined {
  const gitPaths = findGitPaths(cwd)
  if (gitPaths === undefined) return undefined
  const commonGitDir = canonicalizePath(gitPaths.commonGitDir)
  const worktreeRoot = canonicalizePath(gitPaths.repoDir)
  const mainRepoRoot = dirname(commonGitDir)
  if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined
  if (canonicalizePath(join(mainRepoRoot, ".git")) !== commonGitDir) return undefined
  if (!hasAgentsOverride(worktreeRoot) && loadLocalAgentsFile(worktreeRoot) === undefined) return undefined
  return canonicalizePath(join(mainRepoRoot, LOCAL_AGENTS_FILENAME))
}

export function discoverLocalAgentsFiles(cwd: string, agentDir: string): LocalAgentsFile[] {
  const resolvedCwd = canonicalizePath(cwd)
  const ancestorDirectories: string[] = []
  let directory = resolvedCwd
  while (true) {
    ancestorDirectories.unshift(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  const files: LocalAgentsFile[] = []
  const seenDirectories = new Set<string>()
  const seenFiles = new Set<string>()
  const shadowedLocalFile = findShadowedLocalAgentsFile(resolvedCwd)
  for (const candidate of [canonicalizePath(agentDir), ...ancestorDirectories]) {
    const canonicalDirectory = canonicalizePath(candidate)
    if (seenDirectories.has(canonicalDirectory)) continue
    seenDirectories.add(canonicalDirectory)
    const file = loadLocalAgentsFile(canonicalDirectory)
    if (file === undefined) continue
    const canonicalFile = canonicalizePath(file.path)
    if (canonicalFile === shadowedLocalFile || seenFiles.has(canonicalFile)) continue
    seenFiles.add(canonicalFile)
    files.push(file)
  }
  return files
}

export function appendLocalAgentsContext(systemPrompt: string, files: readonly LocalAgentsFile[]): string {
  if (files.length === 0) return systemPrompt
  const context = files.map(({ path, content }) => `## ${path}\n\n${content}`).join("\n\n")
  return `${systemPrompt}\n\n# Local Project Context\n\nThe following local context files have been loaded by Pi Station:\n\n${context}`
}

export function agentsLocalExtension(agentDir: string): InlineExtension {
  return {
    name: "agents-local",
    factory: (pi) => {
      pi.on("before_agent_start", (event) => {
        const files = discoverLocalAgentsFiles(event.systemPromptOptions.cwd, agentDir)
        if (files.length === 0) return
        return { systemPrompt: appendLocalAgentsContext(event.systemPrompt, files) }
      })
    },
  }
}
