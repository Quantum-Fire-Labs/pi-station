// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fixtureState, selectFixtureSession } from "./workspace";

describe("fixture Workspace controller", () => {
  it("updates the selected Session and visible details deterministically", () => {
    const target = fixtureState.sessions[1]!;
    const selected = selectFixtureSession(fixtureState, target.sessionKey);

    expect(selected.selectedSessionKey).toEqual(target.sessionKey);
    expect(selected.selected.details?.name).toBe("Application client");
    expect(selected.selected.timeline).toEqual([]);
  });
});
