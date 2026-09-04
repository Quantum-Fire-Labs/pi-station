import type { ApprovalRequest } from "@pi-station/application-protocol"
import type {
  ApplicationQueueSnapshot,
  SessionDetails,
  SessionKey,
  SessionProjection,
  TimelineItem,
} from "./workspace-model"


export interface SelectedSessionState {
  readonly sessionKey?: SessionKey
  readonly generationId?: string
  readonly historyRevision?: string
  readonly projection?: SessionProjection
  readonly details?: SessionDetails
  readonly timeline: readonly TimelineItem[]
  readonly queue?: ApplicationQueueSnapshot
  readonly hasEarlierHistory: boolean
  readonly historyCursor?: string
  readonly commandApproval?: ApprovalRequest
}

export const initialSelectedSessionState = (): SelectedSessionState => ({
  timeline: [],
  hasEarlierHistory: false,
})

