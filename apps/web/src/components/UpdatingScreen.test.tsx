// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UpdatingScreen } from "./UpdatingScreen";

describe("UpdatingScreen", () => {
  it("explains Session safety and automatic recovery", () => {
    render(<UpdatingScreen />);

    expect(screen.getByRole("heading", { name: "Updating Pi Station" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Active Sessions remain safe");
    expect(screen.getByRole("status")).toHaveTextContent("retry automatically");
    expect(screen.getByRole("status")).toHaveTextContent("return to your Workspace");
  });
});
