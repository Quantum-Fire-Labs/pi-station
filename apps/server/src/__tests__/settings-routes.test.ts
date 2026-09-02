import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionRuntime } from "../session-runtime.js"
import type { SessionIndex } from "../domain.js"
import { createPiStationServer } from "../server.js"
import { SessionAttentionStore } from "../session-attention.js"
import { SharedFileService } from "../shared-files.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("Pi Station Session settings routes", () => {
  it("returns settings and applies model and thinking through runner controls", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-station-settings-"))
    roots.push(dataDir)
    const saved = {
      id: "session-1",
      projectId: "pending",
      path: "/sessions/session-1.jsonl",
      modifiedAt: "2026-01-01T00:00:00.000Z",
    }
    let projectId = ""
    const refreshedAt = "2026-01-02T00:00:00.000Z"
    const refreshSession = vi.fn((key: { projectId: string }) =>
      Promise.resolve({ ...saved, projectId: key.projectId, modifiedAt: refreshedAt }))
    const index: SessionIndex = {
      list: () => Promise.resolve([{ ...saved, projectId }]),
      get: (key) =>
        Promise.resolve(
          key.sessionId === saved.id
            ? { ...saved, projectId: key.projectId }
            : undefined,
        ),
      indexSession: (session) => Promise.resolve(session),
      refreshSession,
      timeline: () => Promise.resolve([]),
      historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
      timelineImage: () => Promise.resolve(undefined),
      rename: (session, name) => Promise.resolve({ ...session, name }),
    }
    let model = {
      provider: "openai",
      id: "gpt-a",
      name: "GPT A",
      reasoning: true,
    }
    let thinkingLevel = "medium"
    const control = vi.fn<SessionRuntime["control"]>(({ command }) => {
      if (command.type === "set_model")
        model = {
          provider: command.provider,
          id: command.modelId,
          name: "GPT B",
          reasoning: true,
        }
      if (command.type === "set_thinking_level") thinkingLevel = command.level
      if (command.type === "get_commands")
        return Promise.resolve({
          type: "response",
          command: command.type,
          success: true,
          data: { commands: [
            { name: "review", description: "Review changes", source: "extension", invocation: "direct" },
            { name: "x".repeat(121), source: "skill", invocation: "prompt" },
            { name: "long-description", description: "x".repeat(501), source: "prompt-template", invocation: "prompt" },
          ] },
        })
      if (command.type === "get_available_models")
        return Promise.resolve({
          type: "response",
          command: command.type,
          success: true,
          data: { models: [model] },
        })
      if (command.type === "get_available_thinking_levels")
        return Promise.resolve({
          type: "response",
          command: command.type,
          success: true,
          data: { levels: ["off", "low", "high"] },
        })
      return Promise.resolve({
        type: "response",
        command: command.type,
        success: true,
        data: { model, thinkingLevel },
      })
    })
    const runner = { run: vi.fn(), control, interruptOwned: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime
    const sharedFiles = new SharedFileService(join(dataDir, "shared"))
    await sharedFiles.initialize()
    await mkdir(sharedFiles.directoryForSession(saved.id))
    await writeFile(join(sharedFiles.directoryForSession(saved.id), "review.md"), "# Review\n")
    const server = createPiStationServer({ dataDir, index, runner, sharedFiles })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string")
      throw new Error("No address")
    const base = `http://127.0.0.1:${address.port}`
    try {
      const projects = await fetch(`${base}/v2/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: dataDir }),
      })
      const projectBody = (await projects.json()) as {
        projects: Array<{ id: string }>
      }
      projectId = projectBody.projects[0]!.id
      await new SessionAttentionStore(dataDir).record({ projectId, sessionId: saved.id }, "attention-1")
      const path = `${base}/v2/projects/${projectId}/sessions/${saved.id}`
      const viewResponse = await fetch(path)
      const view = (await viewResponse.json()) as {
        session: { modifiedAt: string; unread: { hasUnread: boolean; latestAttentionId?: string } }
        settings: {
          model: { modelId: string }
          thinkingLevel: string
          supportedThinkingLevels: string[]
        }
        commandInventory: Array<{ name: string; description?: string; source: string; invocation: string }>
        sharedFiles: Array<{ name: string; url: string; size: number; modifiedAt: number }>
      }
      expect(viewResponse.headers.get("cache-control")).toBe("no-store")
      expect(view.session.modifiedAt).toBe(refreshedAt)
      expect(view.session.unread).toEqual({ hasUnread: true, latestAttentionId: "attention-1" })
      const markedRead = await fetch(`${path}/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attentionId: "attention-1" }),
      })
      expect(markedRead.status).toBe(200)
      expect(await markedRead.json()).toMatchObject({ unread: { hasUnread: false } })
      expect(refreshSession).toHaveBeenCalledWith({ projectId, sessionId: saved.id }, expect.objectContaining({ id: projectId }))
      expect(view.settings).toMatchObject({
        model: { modelId: "gpt-a" },
        thinkingLevel: "medium",
        supportedThinkingLevels: ["off", "low", "high"],
      })
      expect(view.commandInventory).toEqual([
        { name: "review", description: "Review changes", source: "extension", invocation: "direct" },
        { name: "long-description", source: "prompt-template", invocation: "prompt" },
      ])
      expect(view.sharedFiles).toEqual([expect.objectContaining({
        name: "review.md",
        url: "/shared/session-1/review.md",
        size: 9,
      })])
      expect(JSON.stringify(view.sharedFiles)).not.toContain("sessionManager")
      await writeFile(join(sharedFiles.directoryForSession(saved.id), "after-turn.txt"), "Done")
      const refreshedFiles = (await (await fetch(`${path}/shared-files`)).json()) as {
        sharedFiles: Array<{ name: string }>
      }
      expect(refreshedFiles.sharedFiles.map((file) => file.name)).toEqual(expect.arrayContaining(["review.md", "after-turn.txt"]))
      const changedModel = await fetch(`${path}/model`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", modelId: "gpt-b" }),
      })
      expect(changedModel.status).toBe(200)
      const changedThinking = await fetch(`${path}/thinking`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "high" }),
      })
      expect(changedThinking.status).toBe(200)
      const reloaded = await fetch(`${path}/reload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(reloaded.status).toBe(200)
      expect(control).toHaveBeenCalledWith(
        expect.objectContaining({
          command: { type: "set_model", provider: "openai", modelId: "gpt-b" },
        }),
      )
      expect(control).toHaveBeenCalledWith(
        expect.objectContaining({
          command: { type: "set_thinking_level", level: "high" },
        }),
      )
      expect(control).toHaveBeenCalledWith(
        expect.objectContaining({ command: { type: "reload" } }),
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
