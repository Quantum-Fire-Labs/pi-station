import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { CreateMessageStashRequest, MessageStash, SessionKey } from "@pi-station/application-protocol"
import { AtomicJsonStore } from "./atomic-json-store.js"
import type { ImageUploadStore } from "./image-uploads.js"
import type { SessionAttachmentStore } from "./session-attachments.js"
import { HttpError } from "./http.js"

interface StoredStash extends MessageStash { readonly projectId: string; readonly sessionId: string }
type StoredStashes = readonly StoredStash[]

export class MessageStashStore {
  readonly #store: AtomicJsonStore<StoredStashes>
  constructor(dataDir: string, readonly attachments: SessionAttachmentStore, readonly images: ImageUploadStore) {
    this.#store = new AtomicJsonStore(join(dataDir, "message-stashes.json"), isStoredStashes)
  }

  async list(key: SessionKey): Promise<readonly MessageStash[]> {
    return (await this.#store.read([])).filter((stash) => matches(stash, key)).map(publicStash)
  }

  async create(key: SessionKey, request: CreateMessageStashRequest): Promise<MessageStash> {
    const uploadedImages = this.images.resolve(request.imageIds ?? [])
    if (uploadedImages === undefined) throw new HttpError(400, "An attached image is missing or expired")
    const files = await this.attachments.resolve(key, request.attachmentIds ?? [])
    if (files === undefined) throw new HttpError(400, "An attached file is missing")
    const persistedImages = await Promise.all(uploadedImages.map((image) => this.attachments.save(key, image.data, image.name, image.mediaType)))
    const stash: StoredStash = {
      id: randomUUID(), projectId: key.projectId, sessionId: key.sessionId,
      text: request.text, createdAt: new Date().toISOString(),
      images: persistedImages.map(fileMetadata), attachments: files.map(fileMetadata),
    }
    await this.#store.update([], (current) => [...current, stash])
    for (const id of request.imageIds ?? []) this.images.delete(id)
    return publicStash(stash)
  }

  async consume(key: SessionKey, id: string): Promise<{ stash: MessageStash; imageIds: readonly string[] }> {
    const candidate = (await this.#store.read([])).find((item) => item.id === id && matches(item, key))
    if (candidate === undefined) throw new HttpError(404, "Stashed message is not available")
    const imageFiles = await this.attachments.resolve(key, candidate.images.map((file) => file.id))
    const files = await this.attachments.resolve(key, candidate.attachments.map((file) => file.id))
    if (imageFiles === undefined || files === undefined) throw new HttpError(409, "A stashed upload is no longer available")
    const imageData = await Promise.all(imageFiles.map((image) => readFile(image.path)))
    let stash: StoredStash | undefined
    await this.#store.update([], (items) => {
      stash = items.find((item) => item.id === id && matches(item, key))
      return stash === undefined ? items : items.filter((item) => item.id !== id)
    })
    if (stash === undefined) throw new HttpError(404, "Stashed message is not available")
    const imageIds = imageFiles.map((image, index) => this.images.add(image.name, image.mediaType as "image/png" | "image/jpeg" | "image/webp", imageData[index]!))
    return { stash: publicStash(stash), imageIds }
  }
}

function matches(stash: StoredStash, key: SessionKey): boolean { return stash.projectId === key.projectId && stash.sessionId === key.sessionId }
function publicStash(stash: StoredStash): MessageStash { return { id: stash.id, text: stash.text, createdAt: stash.createdAt, images: stash.images, attachments: stash.attachments } }
function fileMetadata(file: { id: string; name: string; mediaType: string; size: number }) { return { id: file.id, name: file.name, mediaType: file.mediaType, size: file.size } }
function isStoredStashes(value: unknown): value is StoredStashes {
  return Array.isArray(value) && value.every((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false
    const stash = item as Record<string, unknown>
    const validFiles = (files: unknown): boolean => Array.isArray(files) && files.every((file) => typeof file === "object" && file !== null && typeof (file as Record<string, unknown>).id === "string" && typeof (file as Record<string, unknown>).name === "string" && typeof (file as Record<string, unknown>).mediaType === "string" && Number.isSafeInteger((file as Record<string, unknown>).size))
    return typeof stash.id === "string" && typeof stash.projectId === "string" && typeof stash.sessionId === "string" && typeof stash.text === "string" && typeof stash.createdAt === "string" && validFiles(stash.images) && validFiles(stash.attachments)
  })
}
