import { randomUUID } from "node:crypto"
import { resolve } from "node:path"

export interface BashSpawnContext {
  readonly command: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

export type BashSpawnResult = BashSpawnContext

/**
 * Move each SDK bash invocation to a systemd transient service. The supervisor
 * remains the SDK-owned child and stops that service when the tool completes or
 * is cancelled. Commands and all descendants therefore have one explicit owner
 * outside pi-station.service.
 */
export function isolateToolProcess(context: BashSpawnContext, platform: NodeJS.Platform = process.platform): BashSpawnResult {
  if (platform === "darwin") {
    const supervisor = resolve(import.meta.dirname, "../../../ops/tool-process-supervisor-darwin.sh")
    return {
      command: `exec ${shellQuote(supervisor)} ${shellQuote(context.command)}`,
      cwd: context.cwd,
      env: { ...context.env },
    }
  }
  if (platform !== "linux") throw new Error(`Pi Station does not support tool process isolation on ${platform}`)

  const unit = `pi-station-tool-${process.pid}-${randomUUID()}.service`
  const supervisor = resolve(import.meta.dirname, "../../../ops/tool-process-supervisor.sh")
  return {
    command: `exec ${shellQuote(supervisor)} ${shellQuote(unit)} ${shellQuote(context.command)}`,
    cwd: context.cwd,
    env: { ...context.env, PI_STATION_TOOL_UNIT: unit },
  }
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
