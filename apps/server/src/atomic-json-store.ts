import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

export class AtomicJsonStore<T> {
  readonly #path: string
  readonly #validate: (value: unknown) => value is T
  #tail: Promise<void> = Promise.resolve()

  constructor(path: string, validate: (value: unknown) => value is T) {
    this.#path = path
    this.#validate = validate
  }

  read(fallback: T): Promise<T> {
    return this.#tail.then(() => this.#readFile(fallback))
  }

  update(fallback: T, change: (current: T) => T): Promise<T> {
    const operation = this.#tail.then(async () => {
      const next = change(await this.#readFile(fallback))
      await this.#writeFile(next)
      return next
    })
    this.#tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  replace(value: T): Promise<T> {
    return this.update(value, () => value)
  }

  async #readFile(fallback: T): Promise<T> {
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as unknown
      if (!this.#validate(value)) throw new Error("Stored JSON data is invalid")
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback
      throw error
    }
  }

  async #writeFile(value: T): Promise<void> {
    const directory = dirname(this.#path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.#path}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temporary, this.#path)
  }
}
