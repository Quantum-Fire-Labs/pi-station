import { readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

export interface SessionMoveAgentInput {
  readonly sessionId: string
  readonly projectId: string
}

export interface SessionMoveAgentResult {
  readonly status: "scheduled" | "unchanged"
  readonly projectId: string
  readonly projectName: string
}

type Handler = (input: SessionMoveAgentInput) => Promise<SessionMoveAgentResult>

/** A narrow bridge from a normal agent tool to the server-owned move coordinator. */
export class SessionMoveAgentBridge {
  #handler?: Handler
  bind(handler: Handler): void { this.#handler = handler }
  invoke(input: SessionMoveAgentInput): Promise<SessionMoveAgentResult> {
    if (this.#handler === undefined) throw new Error("Session moves are unavailable")
    return this.#handler(input)
  }
}

/** Change only the Session header cwd. All identity and history entries stay unchanged. */
export async function rewriteSessionCwd(path: string, cwd: string): Promise<void> {
  const content = await readFile(path, "utf8")
  const newline = content.indexOf("\n")
  const headerText = newline < 0 ? content : content.slice(0, newline)
  let header: unknown
  try { header = JSON.parse(headerText) } catch { throw new Error("Session header is invalid") }
  if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string") throw new Error("Session header is invalid")
  const changed = `${JSON.stringify({ ...header, cwd })}${newline < 0 ? "\n" : content.slice(newline)}`
  const temporary = join(dirname(path), `.${randomUUID()}.move.tmp`)
  await writeFile(temporary, changed, { mode: 0o600 })
  await rename(temporary, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
