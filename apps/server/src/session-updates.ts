import type { ServerResponse } from "node:http"
import type { SavedSession, SessionPhase } from "@pi-station/application-protocol"

interface SessionPhaseSummary {
  readonly projectId: string
  readonly sessionId: string
  readonly phase: SessionPhase
  readonly epoch: string
  readonly generation: number
}

const MAX_REPLAY_UPDATES = 512

interface RecordedUpdate {
  readonly id: number
  readonly body: string
}

export class SessionUpdates {
  readonly #responses = new Set<ServerResponse>()
  readonly #records: RecordedUpdate[] = []
  #sequence = 0

  get sequence(): number {
    return this.#sequence
  }

  subscribe(response: ServerResponse, after: number): () => void {
    for (const record of this.#records) {
      if (record.id > after) response.write(record.body)
    }
    this.#responses.add(response)
    return () => this.#responses.delete(response)
  }

  publish(session: SavedSession): void {
    this.#record("session.updated", { version: 2, type: "session.updated", session })
  }

  publishPhase(session: SessionPhaseSummary): void {
    this.#record("session.phase", { version: 2, type: "session.phase", session })
  }

  #record(event: string, value: unknown): void {
    const id = ++this.#sequence
    const body = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(value)}\n\n`
    this.#records.push({ id, body })
    if (this.#records.length > MAX_REPLAY_UPDATES) this.#records.shift()
    for (const response of this.#responses) response.write(body)
  }
}
