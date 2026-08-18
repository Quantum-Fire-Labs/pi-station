// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledJob } from "@pi-station/application-protocol";
import type { ApplicationClient } from "../application/application-client";
import { ScheduledJobs } from "./ScheduledJobs";

afterEach(cleanup);

const job: ScheduledJob = {
  id: "job-1",
  projectId: "project-1",
  title: "Daily review",
  prompt: "Review the Project",
  target: { type: "new-session" },
  schedule: {
    type: "recurring",
    frequency: "weekly",
    weekdays: [1, 3],
    localTime: "09:30",
    timezone: "America/New_York",
    anchorUtc: "2026-06-15T14:30:00.000Z",
  },
  state: "active",
  nextRunAt: "2026-06-15T14:30:00.000Z",
  pending: false,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  history: [{
    id: "run-1",
    scheduledAt: "2026-06-08T14:30:00.000Z",
    attemptedAt: "2026-06-08T14:30:00.000Z",
    completedAt: "2026-06-08T14:31:00.000Z",
    status: "succeeded",
    origin: "schedule",
    sessionId: "session-1",
  }],
};

function client(jobs: ScheduledJob[] = []) {
  const mocks = {
    list: vi.fn().mockResolvedValue(jobs),
    create: vi.fn().mockResolvedValue(job),
    update: vi.fn().mockResolvedValue(job),
    action: vi.fn().mockResolvedValue(undefined),
  };
  const api = {
    listScheduledJobs: mocks.list,
    createScheduledJob: mocks.create,
    updateScheduledJob: mocks.update,
    scheduledJobAction: mocks.action,
  } as unknown as ApplicationClient;
  return { api, mocks };
}

const sessions = [{
  name: "Open work",
  sessionKey: { hostId: "project-1", piSessionId: "session-1" },
}] as never[];

describe("ScheduledJobs", () => {
  it("creates a one-time job with an existing open Session target", async () => {
    const { api, mocks } = client();
    render(<ScheduledJobs client={api} projectId="project-1" sessions={sessions} />);

    fireEvent.click(screen.getByRole("button", { name: "New Scheduled Job" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Run review" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Review now" } });
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "session-1" } });
    fireEvent.change(screen.getByLabelText("Local date and time"), { target: { value: "2027-01-02T10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Scheduled Job" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("project-1", {
      title: "Run review",
      prompt: "Review now",
      target: { type: "existing-session", sessionId: "session-1" },
      schedule: { type: "one-time", localDateTime: "2027-01-02T10:30" },
    }));
  });

  it("creates a flexible calendar interval from a friendly preset", async () => {
    const { api, mocks } = client();
    render(<ScheduledJobs client={api} projectId="project-1" sessions={sessions} />);
    fireEvent.click(screen.getByRole("button", { name: "New Scheduled Job" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Quarterly review" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Review" } });
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "interval" } });
    fireEvent.change(screen.getByLabelText("Common interval"), { target: { value: "3:month" } });
    fireEvent.change(screen.getByLabelText(/Local start/), { target: { value: "2026-01-31T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Scheduled Job" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("project-1", expect.objectContaining({ schedule: { type: "recurring", frequency: "interval", interval: 3, intervalUnit: "month", localStart: "2026-01-31T09:00" } })));
  });

  it("edits all stored weekly fields and shows timezone and run history", async () => {
    const { api, mocks } = client([job]);
    render(<ScheduledJobs client={api} projectId="project-1" sessions={sessions} />);

    const title = await screen.findByRole("button", { name: /Daily review/ });
    expect(screen.queryByText("Review the Project")).toBeNull();
    expect(screen.queryByText("Target: New Session")).toBeNull();
    fireEvent.click(title);
    expect(screen.getByText("Review the Project")).toBeTruthy();
    expect(screen.getByText(/Scheduled run/)).toBeTruthy();
    expect(screen.getByText(/America\/New_York/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText<HTMLInputElement>("Monday").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Wednesday").checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Scheduled Job" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("job-1", expect.objectContaining({
      title: "Changed",
      schedule: { type: "recurring", frequency: "weekly", weekdays: [1, 3], localTime: "09:30" },
    })));
  });

  it("requires explicit delete confirmation", async () => {
    const { api, mocks } = client([job]);
    render(<ScheduledJobs client={api} projectId="project-1" sessions={sessions} />);
    fireEvent.click(await screen.findByRole("button", { name: /Daily review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(mocks.action).toHaveBeenCalledWith("job-1", "delete"));
  });
});
