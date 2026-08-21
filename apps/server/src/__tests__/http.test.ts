import { describe, expect, it } from "vitest"
import type { IncomingMessage } from "node:http"
import { assertAllowedOrigin, HttpError } from "../http.js"

function request(origin?: string): IncomingMessage {
  return { headers: origin === undefined ? {} : { origin } } as IncomingMessage
}

describe("Pi Station origin boundary", () => {
  it("accepts configured and loopback web origins", () => {
    expect(() => assertAllowedOrigin(request("http://127.0.0.1:8801"))).not.toThrow()
    expect(() => assertAllowedOrigin(request("http://127.0.0.1:8797"))).not.toThrow()
    expect(() => assertAllowedOrigin(request("https://localhost:8797"))).not.toThrow()
    expect(() => assertAllowedOrigin(request("http://[::1]:8797"))).not.toThrow()
  })

  it("rejects unrelated and malformed origins", () => {
    expect(() => assertAllowedOrigin(request("http://example.test"))).toThrow(HttpError)
    expect(() => assertAllowedOrigin(request("null"))).toThrow(HttpError)
    expect(() => assertAllowedOrigin(request("file:///tmp/station"))).toThrow(HttpError)
  })
})
