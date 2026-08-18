import { describe, expect, it, vi } from "vitest";
import { ScheduledJobAgentBridge } from "../scheduled-jobs.js";
import { scheduledTools } from "../session-runtime.js";

describe("Scheduled Job agent tools", () => {
  it("forwards list, get, create, update, pause, resume, delete, and run-now", async () => {
    const bridge = new ScheduledJobAgentBridge();
    const invoke = vi.fn<(action: string, input: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ ok: true });
    bridge.bind(invoke);
    const tools = scheduledTools(bridge, "project-1", "session-1");
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const mutation = {
      title: "Review",
      prompt: "Review this Project",
      target: { type: "new-session" as const },
      schedule: { type: "recurring" as const, frequency: "interval" as const, interval: 2, intervalUnit: "week" as const, localStart: "2026-01-01T09:00" },
    };

    const execute = (name: string, input: Record<string, unknown>) => byName.get(name)!.execute(
      "call",
      input,
      new AbortController().signal,
      () => {},
      {} as never,
    );
    await execute("list_scheduled_jobs", {});
    await execute("get_scheduled_job", { id: "job-1" });
    await execute("create_scheduled_job", mutation);
    await execute("update_scheduled_job", { id: "job-1", ...mutation });
    await execute("pause_scheduled_job", { id: "job-1" });
    await execute("resume_scheduled_job", { id: "job-1" });
    await execute("delete_scheduled_job", { id: "job-1" });
    await execute("run_scheduled_job_now", { id: "job-1" });

    expect(invoke.mock.calls.map(([action]) => action)).toEqual([
      "list", "get", "create", "update", "pause", "resume", "delete", "run-now",
    ]);
    expect(invoke.mock.calls[2]?.[1]).toMatchObject({
      projectId: "project-1",
      mutation: { ...mutation, actor: "Pi Session session-1" },
    });
    expect(invoke.mock.calls[3]?.[1]).toMatchObject({ id: "job-1", projectId: "project-1" });
  });
});
