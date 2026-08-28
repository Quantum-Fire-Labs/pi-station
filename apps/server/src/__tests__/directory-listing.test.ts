import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { listDirectories } from "../server.js"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("directory listing", () => {
  it("includes symlinks to directories and ignores other symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-directory-listing-"))
    const target = await mkdtemp(join(tmpdir(), "pi-directory-target-"))
    directories.push(root, target)
    await mkdir(join(root, "directory"))
    await writeFile(join(root, "file.txt"), "file")
    await symlink(target, join(root, "linked-directory"))
    await symlink(join(root, "file.txt"), join(root, "linked-file"))
    await symlink(join(root, "missing"), join(root, "broken-link"))

    const result = await listDirectories(root, false) as { directories: readonly { name: string }[] }

    expect(result.directories.map(({ name }) => name)).toHaveLength(2)
    expect(result.directories.map(({ name }) => name)).toEqual(expect.arrayContaining(["directory", "linked-directory"]))
  })
})
