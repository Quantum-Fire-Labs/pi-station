// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicationClient } from "../application/application-client";
import { UpdateSettingsPage } from "./UpdateSettingsPage";

afterEach(() => cleanup());

it("shows versions, persists a selected channel, and requests an update", async () => {
  const getUpdateStatus = vi.fn().mockResolvedValue({ channel: "stable", currentVersion: "1.0.0", latestVersion: "1.1.0", updateAvailable: true });
  const setUpdateChannel = vi.fn().mockResolvedValue({ channel: "edge", currentVersion: "1.0.0", latestVersion: "1.2.0+abcdef0", updateAvailable: true });
  const requestUpdate = vi.fn().mockResolvedValue(undefined);
  const client = { getUpdateStatus, setUpdateChannel, requestUpdate } as unknown as ApplicationClient;
  render(<UpdateSettingsPage client={client} onBack={vi.fn()} />);

  expect(await screen.findByText("1.0.0")).toBeInTheDocument();
  expect(screen.getByText("1.1.0")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Release channel"), "edge");
  expect(setUpdateChannel).toHaveBeenCalledWith("edge");
  expect(await screen.findByText("1.2.0+abcdef0")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Update Pi Station" }));
  expect(requestUpdate).toHaveBeenCalledOnce();
  expect(await screen.findByText(/Update requested/)).toBeInTheDocument();
  expect(screen.getByText(/does not install updates automatically/i)).toBeInTheDocument();
});
