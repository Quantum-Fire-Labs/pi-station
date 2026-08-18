import { randomBytes } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { HttpError } from "./http.js"

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_MEMORY_BYTES = 40 * 1024 * 1024
const IMAGE_TTL_MS = 30 * 60 * 1000

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp"
export interface UploadedImage { readonly mediaType: ImageMediaType; readonly data: Buffer }
interface StoredImage extends UploadedImage { readonly expiresAt: number }

const IMAGE_TYPES = new Set<ImageMediaType>(["image/png", "image/jpeg", "image/webp"])

export function imageMediaType(request: IncomingMessage): ImageMediaType {
  const value = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase()
  if (!IMAGE_TYPES.has(value as ImageMediaType)) {
    throw new HttpError(415, "Use a PNG, JPEG, or WebP image")
  }
  return value as ImageMediaType
}

export async function readImageBody(request: IncomingMessage, mediaType: ImageMediaType): Promise<Buffer> {
  const contentLength = request.headers["content-length"]
  if (contentLength !== undefined) {
    const declared = Number(contentLength)
    if (!Number.isSafeInteger(declared) || declared < 0) throw new HttpError(400, "Image size is invalid")
    if (declared > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is larger than 10 MB")
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image is larger than 10 MB")
    chunks.push(bytes)
  }
  const image = Buffer.concat(chunks)
  if (!matchesImageSignature(image, mediaType)) throw new HttpError(400, "Image data does not match its file type")
  return image
}

export class ImageUploadStore {
  readonly #images = new Map<string, StoredImage>()
  #bytes = 0

  add(mediaType: ImageMediaType, data: Buffer): string {
    this.#purgeExpired()
    while (this.#bytes + data.length > MAX_IMAGE_MEMORY_BYTES) {
      const oldest = this.#images.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
    let id: string
    do id = randomBytes(24).toString("base64url"); while (this.#images.has(id))
    this.#images.set(id, { mediaType, data, expiresAt: Date.now() + IMAGE_TTL_MS })
    this.#bytes += data.length
    return id
  }

  resolve(ids: readonly string[]): readonly UploadedImage[] | undefined {
    this.#purgeExpired()
    const images = ids.map((id) => this.#images.get(id))
    return images.every((image) => image !== undefined) ? images : undefined
  }

  delete(id: string): boolean {
    const image = this.#images.get(id)
    if (image === undefined) return false
    this.#images.delete(id)
    this.#bytes -= image.data.length
    return true
  }

  #purgeExpired(): void {
    const now = Date.now()
    for (const [id, image] of this.#images) if (image.expiresAt <= now) this.delete(id)
  }
}

export function matchesImageSignature(data: Buffer, mediaType: ImageMediaType): boolean {
  if (mediaType === "image/png") return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mediaType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP"
}
