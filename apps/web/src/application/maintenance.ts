export interface MaintenanceMonitorDependencies {
  readonly fetchStatus: () => Promise<Response>;
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
  readonly onChange: (updating: boolean) => void;
  readonly onRecovered: () => void;
  readonly intervalMs?: number;
}

export class MaintenanceMonitor {
  private timer: unknown;
  private stopped = true;
  private expected = false;

  constructor(private readonly dependencies: MaintenanceMonitorDependencies) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.check();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.dependencies.cancel(this.timer);
    this.timer = undefined;
  }

  private async check(): Promise<void> {
    try {
      const response = await this.dependencies.fetchStatus();
      if (response.ok) {
        const value = await response.json() as { updating?: unknown };
        if (value.updating === true) {
          this.expected = true;
          this.dependencies.onChange(true);
        } else if (value.updating === false) {
          const recovered = this.expected;
          this.expected = false;
          this.dependencies.onChange(false);
          if (recovered) this.dependencies.onRecovered();
        }
      }
    } catch {
      // Keep the expected maintenance state across the service restart boundary.
    }

    if (!this.stopped) {
      this.timer = this.dependencies.schedule(
        () => void this.check(),
        this.dependencies.intervalMs ?? 1_000,
      );
    }
  }
}
