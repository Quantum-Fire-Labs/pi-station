import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
const forbidden = [
  { label: "maintainer home path", pattern: /\/home\/quantumfire/iu },
  { label: "maintainer hostname", pattern: new RegExp(`taila${"78937"}`, "iu") },
  { label: "maintainer notification address", pattern: /notifications@quantumfire\.ca/iu },
  { label: "private Pi fork path", pattern: /\.local\/share\/pi-fork/iu },
]
const findings = []
for (const file of files) {
  const path = resolve(root, file)
  let content
  try {
    content = readFileSync(path, "utf8")
  } catch {
    continue
  }
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) findings.push(`${file}: ${rule.label}`)
  }
}
if (findings.length > 0) {
  console.error(`Open-source audit failed:\n${findings.map((finding) => `- ${finding}`).join("\n")}`)
  process.exitCode = 1
} else {
  console.log(`Open-source audit passed for ${files.length} tracked files.`)
}
