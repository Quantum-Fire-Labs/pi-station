export interface NewAgentInProjectInput {
  readonly projectId: string
  readonly name: string
  readonly prompt: string
}

export interface NewAgentInProjectResult {
  readonly sessionId: string
  readonly projectId: string
  readonly status: "started"
}

type Handler = (input: NewAgentInProjectInput) => Promise<NewAgentInProjectResult>

/** A narrow runtime-to-host bridge for normal managed Session creation. */
export class NewAgentInProjectBridge {
  #handler?: Handler

  bind(handler: Handler): void {
    this.#handler = handler
  }

  invoke(input: NewAgentInProjectInput): Promise<NewAgentInProjectResult> {
    if (this.#handler === undefined) throw new Error("Starting a new agent in a Project is unavailable")
    return this.#handler(input)
  }
}
