import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionIndex } from "../domain.js";
import type { SessionRuntime } from "../session-runtime.js";
import { createPiStationServer } from "../server.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const index: SessionIndex = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(undefined),
  indexSession: (session) => Promise.resolve(session),
  refreshSession: () => Promise.resolve(undefined),
  timeline: () => Promise.resolve([]),
  historyPage: () => Promise.resolve({ version: 2, revision: "empty", hasEarlier: false, timeline: [] }),
  timelineImage: () => Promise.resolve(undefined),
  rename: (session, name) => Promise.resolve({ ...session, name }),
};

async function json(base: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  return { response, body: response.status === 204 ? undefined : await response.json() as Record<string, unknown> };
}

describe("Scheduled Job HTTP routes", () => {
  it("supports list, get, create, update, pause, resume, run-now, and delete", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pi-scheduled-routes-data-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-scheduled-routes-project-"));
    directories.push(dataDir, projectRoot);
    const runner = { run: vi.fn(), control: vi.fn(), dispose: vi.fn() } as unknown as SessionRuntime;
    const server = createPiStationServer({ dataDir, index, runner });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No server address");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const project = await json(base, "/v2/projects", "POST", { root: projectRoot });
      const projectId = (project.body!.projects as Array<{ id: string }>)[0]!.id;
      const mutation = {
        title: "Review",
        prompt: "Review this Project",
        target: { type: "new-session" },
        schedule: { type: "recurring", frequency: "daily", localTime: "09:00" },
      };
      expect((await json(base, `/v2/scheduled-jobs?projectId=${projectId}`)).body).toMatchObject({ jobs: [] });
      const created = await json(base, "/v2/scheduled-jobs", "POST", { projectId, ...mutation });
      expect(created.response.status).toBe(201);
      const id = (created.body!.job as { id: string }).id;
      expect((await json(base, `/v2/scheduled-jobs/${id}`)).response.status).toBe(200);
      expect((await json(base, `/v2/scheduled-jobs/${id}`, "PUT", { ...mutation, title: "Updated" })).body).toMatchObject({ job: { title: "Updated" } });
      expect((await json(base, `/v2/scheduled-jobs/${id}/pause`, "POST", {})).body).toMatchObject({ job: { state: "paused" } });
      expect((await json(base, `/v2/scheduled-jobs/${id}/resume`, "POST", {})).body).toMatchObject({ job: { state: "active" } });
      expect((await json(base, `/v2/projects/${projectId}/close`, "POST", {})).body).toMatchObject({ projects: [{ id: projectId, closed: true }] });
      expect((await json(base, `/v2/scheduled-jobs/${id}/run-now`, "POST", {})).response.status).toBe(202);
      expect((await json(base, "/v2/projects")).body).toMatchObject({ projects: [{ id: projectId }] });
      expect(((await json(base, "/v2/projects")).body!.projects as Array<{ closed?: boolean }>)[0]?.closed).toBeUndefined();

      const fixed = await json(base, "/v2/scheduled-jobs", "POST", { ...mutation, projectId, target: { type: "existing-session", sessionId: "missing-session" } });
      const fixedId = (fixed.body!.job as { id: string }).id;
      await json(base, `/v2/projects/${projectId}/close`, "POST", {});
      expect((await json(base, `/v2/scheduled-jobs/${fixedId}/run-now`, "POST", {})).response.status).toBe(202);
      expect(((await json(base, "/v2/projects")).body!.projects as Array<{ closed?: boolean }>)[0]?.closed).toBeUndefined();

      expect((await json(base, `/v2/scheduled-jobs/${id}`, "DELETE")).response.status).toBe(204);
      expect((await json(base, `/v2/scheduled-jobs/${id}`)).response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
