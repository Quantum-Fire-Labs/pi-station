import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { AtomicJsonStore } from "./atomic-json-store.js"

export interface VoiceSettings {
  readonly transcriptionProvider: "openai"
  readonly transcriptionModel: string
  readonly speechProvider: "openai" | "browser"
  readonly speechModel: string
  readonly speechVoice: string
  readonly speechSpeed: number
  readonly maxRecordingSeconds: number
  readonly voiceAutoplay: boolean
  readonly openAiKeyConfigured: boolean
}

type StoredVoiceSettings = Omit<VoiceSettings, "speechProvider" | "openAiKeyConfigured"> & { readonly credential?: { ciphertext: string; iv: string; tag: string } }

const defaults: StoredVoiceSettings = { transcriptionProvider: "openai", transcriptionModel: "gpt-4o-mini-transcribe", speechModel: "gpt-4o-mini-tts", speechVoice: "alloy", speechSpeed: 1, maxRecordingSeconds: 60, voiceAutoplay: true }
const validModel = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/u.test(value)
const validStored = (value: unknown): value is StoredVoiceSettings => {
  if (typeof value !== "object" || value === null) return false
  const item = value as Partial<StoredVoiceSettings>
  return item.transcriptionProvider === "openai" && validModel(item.transcriptionModel) && validModel(item.speechModel) && validModel(item.speechVoice)
    && typeof item.speechSpeed === "number" && item.speechSpeed >= 0.25 && item.speechSpeed <= 4
    && Number.isInteger(item.maxRecordingSeconds) && item.maxRecordingSeconds! >= 15 && item.maxRecordingSeconds! <= 120
    && typeof item.voiceAutoplay === "boolean"
}

export class VoiceSettingsError extends Error {}

export class VoiceSettingsStore {
  readonly #store: AtomicJsonStore<StoredVoiceSettings>
  readonly #keyPath: string
  #key?: Buffer

  constructor(dataDir: string) {
    this.#store = new AtomicJsonStore(join(dataDir, "voice-settings.json"), validStored)
    this.#keyPath = join(dataDir, "voice-credential-key")
  }

  async read(): Promise<VoiceSettings> { return this.#public(await this.#store.read(defaults)) }

  async update(input: unknown): Promise<VoiceSettings> {
    if (typeof input !== "object" || input === null || Array.isArray(input)) throw new VoiceSettingsError("Voice settings are invalid")
    const value = input as Record<string, unknown>
    const next = await this.#store.update(defaults, (current) => {
      const transcriptionModel = value.transcriptionModel ?? current.transcriptionModel
      const speechModel = value.speechModel ?? current.speechModel
      const speechVoice = value.speechVoice ?? current.speechVoice
      const speechSpeed = value.speechSpeed ?? current.speechSpeed
      const maxRecordingSeconds = value.maxRecordingSeconds ?? current.maxRecordingSeconds
      const voiceAutoplay = value.voiceAutoplay ?? current.voiceAutoplay
      if (!validModel(transcriptionModel) || !validModel(speechModel) || !validModel(speechVoice)) throw new VoiceSettingsError("Voice model or voice is invalid")
      if (typeof speechSpeed !== "number" || !Number.isFinite(speechSpeed) || speechSpeed < 0.25 || speechSpeed > 4) throw new VoiceSettingsError("Speech speed is invalid")
      if (!Number.isInteger(maxRecordingSeconds) || (maxRecordingSeconds as number) < 15 || (maxRecordingSeconds as number) > 120) throw new VoiceSettingsError("Maximum recording length is invalid")
      if (typeof voiceAutoplay !== "boolean") throw new VoiceSettingsError("Voice autoplay is invalid")
      return this.#stored(current, { transcriptionModel, speechModel, speechVoice, speechSpeed, maxRecordingSeconds: maxRecordingSeconds as number, voiceAutoplay })
    })
    return this.#public(next)
  }

  async setOpenAiKey(value: unknown): Promise<VoiceSettings> {
    if (typeof value !== "string" || value.trim().length < 20 || value.trim().length > 500 || !value.trim().startsWith("sk-")) throw new VoiceSettingsError("OpenAI API key is invalid")
    const key = await this.#encryptionKey(); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv)
    const ciphertext = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()])
    const next = await this.#store.update(defaults, (current) => this.#stored(current, { credential: { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") } }))
    return this.#public(next)
  }

  async removeOpenAiKey(): Promise<VoiceSettings> {
    return this.#public(await this.#store.update(defaults, (current) => this.#stored(current, { credential: undefined })))
  }

  async openAiKey(): Promise<string | undefined> {
    const credential = (await this.#store.read(defaults)).credential
    if (credential === undefined) return undefined
    const decipher = createDecipheriv("aes-256-gcm", await this.#encryptionKey(), Buffer.from(credential.iv, "base64"))
    decipher.setAuthTag(Buffer.from(credential.tag, "base64"))
    return Buffer.concat([decipher.update(Buffer.from(credential.ciphertext, "base64")), decipher.final()]).toString("utf8")
  }

  #stored(current: StoredVoiceSettings, changes: Omit<Partial<StoredVoiceSettings>, "credential"> & { credential?: StoredVoiceSettings["credential"] | undefined }): StoredVoiceSettings {
    const value = { ...current, ...changes }
    return {
      transcriptionProvider: "openai",
      transcriptionModel: value.transcriptionModel,
      speechModel: value.speechModel,
      speechVoice: value.speechVoice,
      speechSpeed: value.speechSpeed,
      maxRecordingSeconds: value.maxRecordingSeconds,
      voiceAutoplay: value.voiceAutoplay,
      ...(value.credential === undefined ? {} : { credential: value.credential }),
    }
  }

  #public(value: StoredVoiceSettings): VoiceSettings {
    return {
      transcriptionProvider: value.transcriptionProvider,
      transcriptionModel: value.transcriptionModel,
      speechProvider: value.credential === undefined ? "browser" : "openai",
      speechModel: value.speechModel,
      speechVoice: value.speechVoice,
      speechSpeed: value.speechSpeed,
      maxRecordingSeconds: value.maxRecordingSeconds,
      voiceAutoplay: value.voiceAutoplay,
      openAiKeyConfigured: value.credential !== undefined,
    }
  }
  async #encryptionKey(): Promise<Buffer> {
    if (this.#key !== undefined) return this.#key
    try { this.#key = await readFile(this.#keyPath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      await mkdir(dirname(this.#keyPath), { recursive: true, mode: 0o700 }); this.#key = randomBytes(32)
      try { await writeFile(this.#keyPath, this.#key, { flag: "wx", mode: 0o600 }) } catch (writeError) { if ((writeError as NodeJS.ErrnoException).code === "EEXIST") this.#key = await readFile(this.#keyPath); else throw writeError }
    }
    if (this.#key.length !== 32) throw new Error("Voice credential key is invalid")
    return this.#key
  }
}
