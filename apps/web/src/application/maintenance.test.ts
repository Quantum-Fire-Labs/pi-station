import { describe, expect, it, vi } from "vitest";
import { MaintenanceMonitor } from "./maintenance";

const status = (updating: boolean): Response => new Response(JSON.stringify({ updating }), { status: 200 });

describe("maintenance monitor", () => {
  it("keeps the updating state through an outage and reports recovery", async () => {
    const callbacks: Array<() => void> = [];
    const changes: boolean[] = [];
    const recovered = vi.fn();
    const fetchStatus = vi.fn<() => Promise<Response>>()
      .mockResolvedValueOnce(status(true))
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce(status(false));
    const monitor = new MaintenanceMonitor({
      fetchStatus,
      schedule: (callback) => { callbacks.push(callback); return callbacks.length; },
      cancel: vi.fn(),
      onChange: (updating) => changes.push(updating),
      onRecovered: recovered,
    });

    monitor.start();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()?.();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    expect(changes).toEqual([true]);

    callbacks.shift()?.();
    await vi.waitFor(() => expect(changes).toEqual([true, false]));
    expect(recovered).toHaveBeenCalledOnce();
    monitor.stop();
  });
})
