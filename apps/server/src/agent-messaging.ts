export interface AgentMessageInput {
  readonly fromSessionId: string
  readonly sessionId: string
  readonly message: string
}

export interface AgentMessageResult {
  readonly delivery: "turn" | "steer"
}

type Handler = (input: AgentMessageInput) => Promise<AgentMessageResult>

export class AgentMessagingBridge {
  #handler?: Handler

  bind(handler: Handler): void {
    this.#handler = handler
  }

  invoke(input: AgentMessageInput): Promise<AgentMessageResult> {
    if (this.#handler === undefined) throw new Error("Agent messaging is unavailable")
    return this.#handler(input)
  }
}
