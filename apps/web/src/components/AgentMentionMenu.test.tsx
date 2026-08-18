import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentMentionMenu, agentMentionLabel, filterAgentMentions, type AgentMentionOption } from "./AgentMentionMenu";

const options: readonly AgentMentionOption[] = [
  { sessionId: "themes", projectName: "Pi Station", sessionName: "Themes" },
  { sessionId: "server", projectName: "Pi Station", sessionName: "Server" },
  { sessionId: "notes", sessionName: "Notes" },
];

describe("agent mentions", () => {
  it("formats Project Sessions and projectless Sessions", () => {
    expect(agentMentionLabel(options[0]!)).toBe("Pi Station: Themes");
    expect(agentMentionLabel(options[2]!)).toBe("Notes");
  });

  it("fuzzy-filters across Project and Session names", () => {
    expect(filterAgentMentions(options, "station theme").map((option) => option.sessionId)).toEqual(["themes"]);
    expect(filterAgentMentions(options, "notes").map((option) => option.sessionId)).toEqual(["notes"]);
  });

  it("groups Project Sessions before projectless Sessions", () => {
    render(<AgentMentionMenu options={options} query="" activeIndex={0} onActiveIndexChange={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Pi Station", "Projectless Sessions"]);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Themes", "Server", "Notes"]);
  });
});
