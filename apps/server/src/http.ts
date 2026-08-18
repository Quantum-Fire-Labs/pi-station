import type { IncomingMessage, ServerResponse } from "node:http"

export const WEB_ORIGIN = process.env.PI_STATION_WEB_ORIGIN ?? "http://127.0.0.1:8801"
export const LOCAL_ORIGIN = process.env.PI_STATION_LOCAL_ORIGIN ?? "http://127.0.0.1:8801"
const MAX_BODY_BYTES = 110_000

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function assertAllowedOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin
  if (origin !== undefined && origin !== WEB_ORIGIN && origin !== LOCAL_ORIGIN) {
    throw new HttpError(403, "Origin is not allowed")
  }
}

export function assertJsonMutation(request: IncomingMessage): void {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new HttpError(415, "Content-Type must be application/json")
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large")
    chunks.push(Buffer.from(chunk))
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new HttpError(400, "Request body must be valid JSON")
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": WEB_ORIGIN,
    vary: "Origin",
  })
  response.end(JSON.stringify(value))
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(response, error.status, { error: error.message })
    return
  }
  sendJson(response, 500, { error: "Internal server error" })
}

export function sendOptions(response: ServerResponse): void {
  response.writeHead(204, {
    "access-control-allow-origin": WEB_ORIGIN,
    "access-control-allow-methods": "GET, PUT, POST, DELETE",
    "access-control-allow-headers": "content-type, last-event-id",
    vary: "Origin",
  })
  response.end()
}
