import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { VoiceSettingsError, VoiceSettingsStore } from "../voice-settings.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("VoiceSettingsStore", () => {
  it("encrypts the OpenAI credential and returns only public settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-voice-")); roots.push(root)
    const store = new VoiceSettingsStore(root)
    const apiKey = `sk-${"a".repeat(40)}`

    expect((await store.read()).openAiKeyConfigured).toBe(false)
    const configured = await store.setOpenAiKey(apiKey)
    expect(configured).toMatchObject({ openAiKeyConfigured: true, speechProvider: "openai" })
    expect(configured).not.toHaveProperty("credential")
    expect(await store.openAiKey()).toBe(apiKey)
    expect(await readFile(join(root, "voice-settings.json"), "utf8")).not.toContain(apiKey)
    expect((await stat(join(root, "voice-credential-key"))).mode & 0o077).toBe(0)
  })

  it("validates and persists normal Voice Mode settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-voice-")); roots.push(root)
    const store = new VoiceSettingsStore(root)
    const settings = await store.update({ transcriptionModel: "whisper-1", speechModel: "tts-1", speechVoice: "nova", speechSpeed: 1.25, maxRecordingSeconds: 90, voiceAutoplay: false })
    expect(settings).toMatchObject({ transcriptionModel: "whisper-1", speechModel: "tts-1", speechVoice: "nova", speechSpeed: 1.25, maxRecordingSeconds: 90, voiceAutoplay: false })
    expect(await store.read()).toMatchObject(settings)
    await expect(store.update({ speechSpeed: 9 })).rejects.toBeInstanceOf(VoiceSettingsError)
  })

  it("reads retired headset settings and removes them on the next save", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-station-voice-")); roots.push(root)
    const path = join(root, "voice-settings.json")
    await writeFile(path, JSON.stringify({ transcriptionProvider: "openai", transcriptionModel: "whisper-1", speechModel: "tts-1", speechVoice: "nova", speechSpeed: 1, maxRecordingSeconds: 60, voiceAutoplay: true, headsetButtonRecording: true }))
    const store = new VoiceSettingsStore(root)

    const settings = await store.read()
    expect(settings).toMatchObject({ transcriptionModel: "whisper-1", voiceAutoplay: true })
    expect(settings).not.toHaveProperty("headsetButtonRecording")
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty("headsetButtonRecording", true)

    const saved = await store.update({ voiceAutoplay: false })
    expect(saved).not.toHaveProperty("headsetButtonRecording")
    expect(JSON.parse(await readFile(path, "utf8"))).not.toHaveProperty("headsetButtonRecording")
  })
})
