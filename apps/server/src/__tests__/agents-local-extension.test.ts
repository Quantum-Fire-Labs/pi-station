import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent"
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, it } from "vitest"
import {
  agentsLocalExtension,
  appendLocalAgentsContext,
  discoverLocalAgentsFiles,
} from "../agents-local-extension.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-station-agents-local-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("agents-local extension", () => {
  it("discovers global and ancestor files from broadest to most specific", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "workspace", "project")
    const service = join(project, "service")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(service, { recursive: true })
    writeFileSync(join(agentDir, "AGENTS.local.md"), "global local")
    writeFileSync(join(project, "AGENTS.local.md"), "project local")
    writeFileSync(join(service, "AGENTS.local.md"), "service local")

    expect(discoverLocalAgentsFiles(service, agentDir)).toEqual([
      { path: join(agentDir, "AGENTS.local.md"), content: "global local" },
      { path: join(project, "AGENTS.local.md"), content: "project local" },
      { path: join(service, "AGENTS.local.md"), content: "service local" },
    ])
  })

  it("does not load a local file from a directory with AGENTS.override.md", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, "AGENTS.local.md"), "project local")
    writeFileSync(join(project, "AGENTS.override.md"), "")

    expect(discoverLocalAgentsFiles(project, agentDir)).toEqual([])
  })

  it("ignores a non-file override candidate", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(join(project, "AGENTS.override.md"), { recursive: true })
    writeFileSync(join(project, "AGENTS.local.md"), "project local")

    expect(discoverLocalAgentsFiles(project, agentDir)).toEqual([
      { path: join(project, "AGENTS.local.md"), content: "project local" },
    ])
  })

  it("applies overrides independently at global and ancestor scopes", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "workspace", "project")
    const service = join(project, "service")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(service, { recursive: true })
    writeFileSync(join(agentDir, "AGENTS.local.md"), "global local")
    writeFileSync(join(agentDir, "AGENTS.override.md"), "global override")
    writeFileSync(join(project, "AGENTS.local.md"), "project local")
    writeFileSync(join(service, "AGENTS.local.md"), "service local")
    writeFileSync(join(service, "AGENTS.override.md"), "service override")

    expect(discoverLocalAgentsFiles(service, agentDir)).toEqual([
      { path: join(project, "AGENTS.local.md"), content: "project local" },
    ])
  })

  it("ignores a non-file local candidate", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(join(project, "AGENTS.local.md"), { recursive: true })

    expect(discoverLocalAgentsFiles(project, agentDir)).toEqual([])
  })

  it("loads local instructions without requiring a shared AGENTS.md", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, "AGENTS.local.md"), "\uFEFFlocal only")

    expect(discoverLocalAgentsFiles(project, agentDir)).toEqual([
      { path: join(project, "AGENTS.local.md"), content: "local only" },
    ])
  })

  it("deduplicates local context reached through symlink aliases", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    const alias = join(root, "project-alias")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, "AGENTS.local.md"), "project local")
    symlinkSync(project, alias, "dir")

    expect(discoverLocalAgentsFiles(alias, agentDir)).toEqual([
      { path: join(project, "AGENTS.local.md"), content: "project local" },
    ])
  })

  it("does not inherit the main checkout local file when a nested worktree shadows it", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const main = join(root, "main")
    const worktree = join(main, ".worktrees", "feature")
    const worktreeSource = join(worktree, "src")
    const worktreeGitDir = join(main, ".git", "worktrees", "feature")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(worktreeSource, { recursive: true })
    mkdirSync(worktreeGitDir, { recursive: true })
    writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(worktreeGitDir, "HEAD"), "ref: refs/heads/feature\n")
    writeFileSync(join(worktreeGitDir, "commondir"), "../..")
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`)
    writeFileSync(join(main, "AGENTS.local.md"), "main local")
    writeFileSync(join(worktree, "AGENTS.local.md"), "worktree local")

    expect(discoverLocalAgentsFiles(worktreeSource, agentDir)).toEqual([
      { path: join(worktree, "AGENTS.local.md"), content: "worktree local" },
    ])
  })

  it("lets a nested worktree override suppress the main checkout local file", () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const main = join(root, "main")
    const worktree = join(main, ".worktrees", "feature")
    const worktreeGitDir = join(main, ".git", "worktrees", "feature")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(worktree, { recursive: true })
    mkdirSync(worktreeGitDir, { recursive: true })
    writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n")
    writeFileSync(join(worktreeGitDir, "HEAD"), "ref: refs/heads/feature\n")
    writeFileSync(join(worktreeGitDir, "commondir"), "../..")
    writeFileSync(join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`)
    writeFileSync(join(main, "AGENTS.local.md"), "main local")
    writeFileSync(join(worktree, "AGENTS.override.md"), "worktree override")

    expect(discoverLocalAgentsFiles(worktree, agentDir)).toEqual([])
  })

  it("loads as a named inline extension through Pi's resource loader", async () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    const loader = new DefaultResourceLoader({
      cwd: project,
      agentDir,
      extensionFactories: [agentsLocalExtension(agentDir)],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    })

    await loader.reload()

    expect(loader.getExtensions().errors).toEqual([])
    const extension = loader.getExtensions().extensions.find(({ path }) => path === "<inline:agents-local>")
    expect(extension?.handlers.get("before_agent_start")).toHaveLength(1)
  })

  it("registers a built-in extension that injects discovered local instructions", async () => {
    const root = temporaryDirectory()
    const agentDir = join(root, "agent")
    const project = join(root, "project")
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, "AGENTS.local.md"), "project local")
    let handler: ((event: BeforeAgentStartEvent) => BeforeAgentStartEventResult | Promise<BeforeAgentStartEventResult | undefined> | undefined) | undefined
    const pi = {
      on: (event: string, candidate: unknown) => {
        if (event === "before_agent_start") handler = candidate as typeof handler
      },
    } as unknown as ExtensionAPI
    const extension = agentsLocalExtension(agentDir)
    if (typeof extension === "function") throw new Error("Expected a named extension")
    await extension.factory(pi)
    if (handler === undefined) throw new Error("Expected before_agent_start handler")

    const result = await handler({
      type: "before_agent_start",
      prompt: "test",
      systemPrompt: "base prompt",
      systemPromptOptions: { cwd: project },
    })

    expect(result?.systemPrompt).toContain("## " + join(project, "AGENTS.local.md"))
    expect(result?.systemPrompt).toContain("project local")
  })

  it("appends local files to the system prompt with source paths", () => {
    expect(appendLocalAgentsContext("base prompt", [
      { path: "/project/AGENTS.local.md", content: "local instructions" },
    ])).toBe(`base prompt

# Local Project Context

The following local context files have been loaded by Pi Station:

## /project/AGENTS.local.md

local instructions`)
    expect(appendLocalAgentsContext("base prompt", [])).toBe("base prompt")
  })
})
