import type { ServerResponse } from "node:http"
import { encodeSse } from "@pi-station/application-protocol"
import type {
  JournalEvent,
  SessionKey,
  StreamEvent,
} from "@pi-station/application-protocol"

const MAX_SESSIONS = 100
const MAX_EVENTS_PER_SESSION = 200
const MAX_BYTES_PER_SESSION = 512_000

interface SessionJournal {
  readonly events: JournalEvent[]
  readonly clients: Set<ServerResponse>
  bytes: number
}

export class EventJournal {
  readonly #journals = new Map<string, SessionJournal>()
  #nextEventId = 1

  cursor(): number {
    return this.#nextEventId - 1
  }

  publish(key: SessionKey, event: StreamEvent): void {
    const journal = this.#getOrCreate(key)
    const entry = { id: this.#nextEventId++, event }
    journal.events.push(entry)
    journal.bytes += eventBytes(entry)
    this.#trim(journal)

    const encoded = encodeSse(event, entry.id)
    for (const client of journal.clients) client.write(encoded)
  }

  subscribe(key: SessionKey, response: ServerResponse, afterId: number): () => void {
    const journal = this.#getOrCreate(key)
    journal.clients.add(response)
    for (const entry of journal.events) {
      if (entry.id > afterId) response.write(encodeSse(entry.event, entry.id))
    }

    return () => {
      journal.clients.delete(response)
    }
  }

  #getOrCreate(key: SessionKey): SessionJournal {
    const id = key.sessionId
    const existing = this.#journals.get(id)
    if (existing !== undefined) {
      this.#journals.delete(id)
      this.#journals.set(id, existing)
      return existing
    }

    const journal: SessionJournal = { events: [], clients: new Set(), bytes: 0 }
    this.#journals.set(id, journal)
    this.#trimSessions()
    return journal
  }

  #trim(journal: SessionJournal): void {
    while (
      journal.events.length > MAX_EVENTS_PER_SESSION
      || journal.bytes > MAX_BYTES_PER_SESSION
    ) {
      const removed = journal.events.shift()
      if (removed === undefined) break
      journal.bytes -= eventBytes(removed)
    }
  }

  #trimSessions(): void {
    if (this.#journals.size <= MAX_SESSIONS) return
    for (const [id, journal] of this.#journals) {
      if (journal.clients.size > 0) continue
      this.#journals.delete(id)
      if (this.#journals.size <= MAX_SESSIONS) return
    }
  }
}

function eventBytes(entry: JournalEvent): number {
  return Buffer.byteLength(JSON.stringify(entry), "utf8")
}
