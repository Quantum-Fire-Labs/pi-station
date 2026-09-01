import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ImageUploadStore } from "../image-uploads.js"
import { MessageStashStore } from "../message-stashes.js"
import { SessionAttachmentStore } from "../session-attachments.js"

const roots: string[] = []
const key = { projectId: "project", sessionId: "session" }
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("MessageStashStore", () => {
  it("persists multiple per-session stashes and restores usable uploads after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-stashes-")); roots.push(root)
    const attachments = new SessionAttachmentStore(root)
    const images = new ImageUploadStore()
    const file = await attachments.save(key, Buffer.from("notes"), "notes.txt", "text/plain")
    const imageId = images.add("screen.png", "image/png", png)
    const store = new MessageStashStore(root, attachments, images)
    const first = await store.create(key, { text: "first", imageIds: [imageId], attachmentIds: [file.id] })
    await store.create(key, { text: "second" })

    const restartedImages = new ImageUploadStore()
    const restarted = new MessageStashStore(root, new SessionAttachmentStore(root), restartedImages)
    expect((await restarted.list(key)).map(({ text }) => text)).toEqual(["first", "second"])
    expect(await restarted.list({ projectId: "project", sessionId: "other" })).toEqual([])

    const consumed = await restarted.consume(key, first.id)
    expect(consumed.stash.attachments[0]?.name).toBe("notes.txt")
    expect(restartedImages.resolve(consumed.imageIds)?.[0]?.data).toEqual(png)
    expect((await restarted.list(key)).map(({ text }) => text)).toEqual(["second"])
    await expect(restarted.consume(key, first.id)).rejects.toMatchObject({ status: 404 })
  })
})
