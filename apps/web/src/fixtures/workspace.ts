import type { SessionKey } from "../application/workspace-model";
import { sessionKeysEqual, type ApplicationState } from "../application/application-client-base";

const hostId = "01900000-0000-7000-8000-000000000001";
const projectA = "01900000-0000-7000-8000-000000000003";
const projectB = "01900000-0000-7000-8000-000000000004";
const sessionKey = { hostId, piSessionId: "session-workspace-fixture" };
const working =
  typeof location === "undefined" ||
  new URLSearchParams(location.search).get("scenario") !== "idle";

export const fixtureState = {
  connection: "ready",
  streamId: "01900000-0000-7000-8000-000000000005",
  applicationSequence: 10,
  malformedFrames: 0,
  hostCapabilities: [],
  managedSessionCreates: {},
  directoryLists: {},
  projectCreates: {},
  projectClosedSessions: {},
  bookmarkMutations: {},
  projectRemovals: {},
  developmentServerRequests: {},
  developmentServerOutput: {},
  developmentServers: [],
  projectBookmarks: [],
  sessionBookmarks: [],
  selectedSessionKey: sessionKey,
  projects: [
    {
      projectId: projectA,
      name: "Pi Station",
      displayPath: "~/workspace/pi-station",
      available: true,
      createdAt: "2026-08-08T10:00:00.000Z",
      updatedAt: "2026-08-08T10:00:00.000Z",
    },
    {
      projectId: projectB,
      name: "Field Notes",
      displayPath: "~/workspace/field-notes",
      available: true,
      createdAt: "2026-08-08T10:00:00.000Z",
      updatedAt: "2026-08-08T10:00:00.000Z",
    },
  ],
  sessions: [
    {
      sessionKey,
      name: "Workspace shell",
      displayPath: "~/workspace/pi-station",
      projectId: projectA,
      generationId: "generation-fixture-a",
      projection: {
        availability: "available",
        synchronization: "synchronized",
        run: working ? "working" : "idle",
        queue: { state: "empty", knownCount: 0 },
        unread: { hasUnread: false },
        management: { kind: "unmanaged" },
        capabilities: [
          "session.prompt.text",
          "session.prompt.steer",
          "session.prompt.follow-up",
          "session.abort",
        ],
      },
    },
    {
      sessionKey: { hostId, piSessionId: "session-client" },
      name: "Application client",
      displayPath: "apps/web",
      projectId: projectA,
      generationId: "generation-fixture-b",
      projection: {
        availability: "available",
        synchronization: "synchronized",
        run: "idle",
        queue: { state: "empty", knownCount: 0 },
        unread: { hasUnread: true },
        management: { kind: "unmanaged" },
        capabilities: [],
      },
    },
    {
      sessionKey: { hostId, piSessionId: "session-notes" },
      name: "Release notes",
      displayPath: "~/workspace/field-notes",
      projectId: projectB,
      generationId: "generation-fixture-c",
      projection: {
        availability: "available",
        synchronization: "synchronized",
        run: "idle",
        queue: { state: "empty", knownCount: 0 },
        unread: { hasUnread: false },
        management: { kind: "unmanaged" },
        capabilities: [],
      },
    },
  ],
  selected: {
    sessionKey,
    generationId: "generation-fixture-a",
    historyRevision: "history-a",
    hasEarlierHistory: false,
    projection: {
      availability: "available",
      synchronization: "synchronized",
      run: working ? "working" : "idle",
      queue: { state: "empty", knownCount: 0 },
      unread: { hasUnread: false },
      management: { kind: "unmanaged" },
      capabilities: [
        "session.prompt.text",
        "session.prompt.steer",
        "session.prompt.follow-up",
        "session.abort",
        "session.close",
        "session.model.set",
        "session.reload",
        "session.rename",
        "session.thinking.set",
      ],
    },
    details: {
      name: "Workspace shell",
      currentDirectoryDisplay: "~/workspace/pi-station",
      projectId: projectA,
      model: { provider: "openai", modelId: "gpt-5.6-sol" },
      modelInventory: [
        { provider: "openai", modelId: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
        { provider: "anthropic", modelId: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
      ],
      thinkingLevel: "medium",
      supportedThinkingLevels: ["off", "low", "medium", "high"],
      commandInventory: [],
    },
    queue: { state: "empty", knownItems: [] },
    timeline: [
      {
        timelineItemId: "user-1",
        sessionKey,
        source: "saved",
        branchOrdinal: 1,
        category: "user-message",
        content: {
          text: "Build the first Workspace shell.\nPreserve the calm reading surface and navigation.",
        },
      },
      {
        timelineItemId: "thinking-1",
        sessionKey,
        source: "saved",
        branchOrdinal: 2,
        category: "thinking",
        content: {
          text: "Reviewing the protocol contract and reference captures",
          state: "complete",
        },
      },
      {
        timelineItemId: "tool-1",
        sessionKey,
        source: "saved",
        branchOrdinal: 3,
        category: "tool-activity",
        content: {
          toolCallId: "tool-call-1",
          name: "read",
          summary: "Read application protocol",
          inputText: "packages/application-protocol/src/index.ts",
          outputText: "Validated the normalized version 2 HTTP and event-stream contract.",
          state: "succeeded",
          truncated: false,
        },
      },
      {
        timelineItemId: "assistant-1",
        sessionKey,
        source: "saved",
        branchOrdinal: 4,
        category: "assistant-response",
        content: {
          text: '## Workspace foundation\n\nThe application has a focused shell with:\n\n- A persistent Project and Session sidebar\n- A normalized Timeline\n- A typed version 2 application client\n\n```ts\nconst protocolVersion = 2\n```\n\nThe composer uses the normalized Pi Station application endpoints.',
          state: "complete",
        },
      },
      ...(working
        ? [
            {
              timelineItemId: "thinking-2",
              sessionKey,
              source: "live" as const,
              liveSequence: 4,
              category: "thinking" as const,
              content: {
                text: "Refining desktop and mobile fidelity",
                state: "streaming" as const,
              },
            },
          ]
        : []),
    ],
  },
} as unknown as ApplicationState;

export function selectFixtureSession(
  state: ApplicationState,
  selectedSessionKey: SessionKey,
): ApplicationState {
  const summary = state.sessions.find((session) =>
    sessionKeysEqual(session.sessionKey, selectedSessionKey),
  );
  if (!summary) return state;

  const isPrimary = sessionKeysEqual(
    selectedSessionKey,
    sessionKey,
  );
  return {
    ...state,
    selectedSessionKey: summary.sessionKey,
    selected: isPrimary
      ? fixtureState.selected
      : {
          sessionKey: summary.sessionKey,
          ...(summary.generationId === undefined
            ? {}
            : { generationId: summary.generationId }),
          historyRevision: `history-${summary.sessionKey.piSessionId}`,
          projection: summary.projection,
          details: {
            name: summary.name,
            currentDirectoryDisplay: summary.displayPath,
            projectId: summary.projectId,
            model: { provider: "openai", modelId: "gpt-5.6-sol" },
            thinkingLevel: "medium",
            commandInventory: [],
          },
          timeline: [],
          queue: { state: "empty", knownItems: [] },
          hasEarlierHistory: false,
        },
  };
}
