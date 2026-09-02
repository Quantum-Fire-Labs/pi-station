import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { filterSlashCommands, SlashCommandMenu, type SlashCommandOption } from "./SlashCommandMenu";

const commands: readonly SlashCommandOption[] = [
  { name: "review", description: "Review the current changes", source: "prompt-template", invocation: "prompt" },
  { name: "skill:diagnose-crash", description: "Diagnose a core dump", source: "skill", invocation: "prompt" },
  { name: "deploy", description: "Deploy the application", source: "extension", invocation: "direct" },
];

describe("SlashCommandMenu", () => {
  it("filters commands by name or description", () => {
    expect(filterSlashCommands(commands, "crash").map(({ name }) => name)).toEqual(["skill:diagnose-crash"]);
    expect(filterSlashCommands(commands, "current changes").map(({ name }) => name)).toEqual(["review"]);
  });

  it("groups commands by source and selects a command", async () => {
    const select = vi.fn();
    render(<SlashCommandMenu options={commands} query="" activeIndex={0} onActiveIndexChange={() => undefined} onSelect={select} />);

    expect(screen.getByText("Extensions")).toBeInTheDocument();
    expect(screen.getByText("Prompts")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /review/i }));
    expect(select).toHaveBeenCalledWith(commands[0]);
  });

  it("shows an empty result", () => {
    render(<SlashCommandMenu options={[]} query="missing" activeIndex={0} onActiveIndexChange={() => undefined} onSelect={() => undefined} />);
    expect(screen.getByText("No commands match “missing”")).toBeInTheDocument();
  });
});
