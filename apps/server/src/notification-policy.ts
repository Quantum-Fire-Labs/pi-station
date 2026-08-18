import type { SessionKey } from "@pi-station/application-protocol"
import type { DelegationStore } from "./delegations.js"

/**
 * Delegation records are the authority for notification ownership. Child
 * Sessions keep their stored attention for compatibility, but only their
 * parent can produce a user-facing notification.
 */
export async function allowsDirectNotification(key: SessionKey, delegations: Pick<DelegationStore, "byChild">): Promise<boolean> {
  return !(await delegations.byChild()).has(key.sessionId)
}
