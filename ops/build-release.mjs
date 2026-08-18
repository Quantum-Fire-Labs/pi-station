import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const versionArgument = process.argv[2]
const version = versionArgument ?? packageJson.version
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) || version === "0.0.0") {
  throw new Error("Supply a release version, for example: npm run release:build -- 0.1.0")
}

if (process.platform !== "linux" && process.platform !== "darwin") throw new Error("Release artifacts support Linux and macOS only")
const platformName = process.platform === "darwin" ? "macos" : "linux"

const outputDirectory = resolve(root, "release")
const stagingDirectory = resolve(tmpdir(), `pi-station-${version}-${process.pid}`)
const artifactName = `pi-station-${version}-${platformName}-${process.arch}.tar.gz`
const artifactPath = resolve(outputDirectory, artifactName)

const run = (file, arguments_, options = {}) => execFileSync(file, arguments_, {
  cwd: root,
  stdio: "inherit",
  ...options,
})

rmSync(stagingDirectory, { recursive: true, force: true })
mkdirSync(stagingDirectory, { recursive: true })
mkdirSync(outputDirectory, { recursive: true })

try {
  run("npm", ["run", "build"])

  for (const path of ["LICENSE", "README.md", "package.json", "package-lock.json", "install.sh", "install-macos.sh"]) {
    cpSync(resolve(root, path), resolve(stagingDirectory, basename(path)))
  }
  for (const path of [
    "apps/server/package.json",
    "apps/server/dist",
    "apps/web/package.json",
    "apps/web/dist",
    "packages/application-protocol/package.json",
    "packages/application-protocol/dist",
    "ops/tool-process-runner.sh",
    "ops/tool-process-supervisor.sh",
    "ops/tool-process-supervisor-darwin.sh",
  ]) {
    cpSync(resolve(root, path), resolve(stagingDirectory, path), { recursive: true })
  }

  const releasePackage = JSON.parse(readFileSync(resolve(stagingDirectory, "package.json"), "utf8"))
  releasePackage.private = true
  releasePackage.scripts = { start: "node apps/server/dist/cli.js" }
  delete releasePackage.devDependencies
  writeFileSync(resolve(stagingDirectory, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`)

  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--workspaces", "--include-workspace-root"], {
    cwd: stagingDirectory,
  })
  writeFileSync(resolve(stagingDirectory, "VERSION"), `${version}\n`)
  run("tar", ["-C", stagingDirectory, "-czf", artifactPath, "."])
  const checksumOutput = process.platform === "darwin"
    ? execFileSync("shasum", ["-a", "256", artifactPath], { encoding: "utf8" })
    : execFileSync("sha256sum", [artifactPath], { encoding: "utf8" })
  const checksum = checksumOutput.trim().split(/\s+/u)[0]
  writeFileSync(`${artifactPath}.sha256`, `${checksum}  ${artifactName}\n`)
  console.log(`Created release/${artifactName}`)
  console.log(`Created release/${artifactName}.sha256`)
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true })
}
