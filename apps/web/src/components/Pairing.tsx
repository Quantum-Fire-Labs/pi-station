import { useEffect, useState, type FormEvent } from "react";

type PairingAttempt = {
  attemptId: string;
  attemptSecret: string;
  code: string;
  expiresAtMs: number;
};

interface PairingProps {
  readonly onApproved: () => void;
}

async function postJson(
  path: string,
  body: Record<string, string>,
): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function isPairingAttempt(value: Partial<PairingAttempt>): value is PairingAttempt {
  return (
    typeof value.attemptId === "string" &&
    typeof value.attemptSecret === "string" &&
    typeof value.code === "string" &&
    typeof value.expiresAtMs === "number"
  );
}

export function Pairing({ onApproved }: PairingProps) {
  const [deviceName, setDeviceName] = useState("");
  const [attempt, setAttempt] = useState<PairingAttempt>();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (attempt === undefined) {
      return;
    }

    let active = true;

    const poll = async (): Promise<void> => {
      if (!active) {
        return;
      }

      if (Date.now() >= attempt.expiresAtMs) {
        setError("This pairing code expired. Start pairing again.");
        setAttempt(undefined);
        return;
      }

      try {
        const response = await postJson("/api/auth/pairings/status", {
          attemptId: attempt.attemptId,
          attemptSecret: attempt.attemptSecret,
        });
        const result = (await response.json()) as { status?: unknown };

        if (response.ok && result.status === "approved") {
          active = false;
          onApproved();
          return;
        }

        if (!response.ok || result.status !== "pending") {
          setError("Pairing could not continue. Start pairing again.");
          setAttempt(undefined);
          return;
        }
      } catch {
        setError("Pi Station is not available. Polling will continue.");
      }

      if (active) {
        window.setTimeout(() => void poll(), 1_000);
      }
    };

    void poll();

    return () => {
      active = false;
    };
  }, [attempt, onApproved]);

  const start = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setStarting(true);
    setError("");

    try {
      const response = await postJson("/api/auth/pairings", { deviceName });
      const result = (await response.json()) as Partial<PairingAttempt>;

      if (!response.ok || !isPairingAttempt(result)) {
        throw new Error("Invalid pairing response");
      }

      setAttempt(result);
    } catch {
      setError("Could not start pairing. Check the device name and Pi Station connection.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="pairing-screen">
      <section className="pairing-card">
        <img src="/pi-station.svg" alt="" width="48" height="48" />
        <h1>Connect this device</h1>

        {attempt === undefined ? (
          <form onSubmit={(event) => void start(event)}>
            <label htmlFor="device-name">Device name</label>
            <input
              id="device-name"
              required
              maxLength={100}
              autoComplete="off"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
            <button type="submit" disabled={starting}>
              {starting ? "Starting…" : "Start pairing"}
            </button>
          </form>
        ) : (
          <div className="pairing-code">
            <p>In the Pi Station repository, run:</p>
            <code>npm run approve:pairing -- {attempt.code}</code>
            <p>
              This one-time code expires in a few minutes. Keep this page open.
            </p>
          </div>
        )}

        {error !== "" && (
          <p className="pairing-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
