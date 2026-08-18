import { describe, expect, it } from "vitest"
import type { IncomingMessage } from "node:http"
import { assertAllowedOrigin, HttpError } from "../http.js"

function request(origin?: string): IncomingMessage {
  return { headers: origin === undefined ? {} : { origin } } as IncomingMessage
}

describe("Pi Station origin boundary", () => {
  it("accepts the local web origin", () => {
    expect(() => assertAllowedOrigin(request("http://127.0.0.1:8801"))).not.toThrow()
  })

  it("rejects an unrelated origin", () => {
    expect(() => assertAllowedOrigin(request("http://example.test"))).toThrow(HttpError)
  })
})
