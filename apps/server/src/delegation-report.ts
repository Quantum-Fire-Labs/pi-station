export const DELEGATION_REPORT_CUSTOM_TYPE = "pi-station-delegation"

export type DelegationReportStatus = "completed" | "failed"

export interface DelegationReportDetails {
  readonly kind: "delegation-report"
  readonly toolCallId: string
  readonly toolName: "delegate_to_agent"
  readonly status: DelegationReportStatus
}

export function delegationReportDetails(value: unknown): DelegationReportDetails | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const details = value as Record<string, unknown>
  if (
    details.kind !== "delegation-report"
    || typeof details.toolCallId !== "string"
    || details.toolCallId.length === 0
    || details.toolName !== "delegate_to_agent"
    || (details.status !== "completed" && details.status !== "failed")
  ) return undefined
  return {
    kind: details.kind,
    toolCallId: details.toolCallId,
    toolName: details.toolName,
    status: details.status,
  }
}
