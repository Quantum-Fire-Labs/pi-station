import { useEffect, useState } from "react";
import type { PiStationUpdateStatus, UpdateChannel } from "@pi-station/application-protocol";
import { RefreshCw } from "lucide-react";
import type { ApplicationClient } from "../application/application-client";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { SettingsLayout } from "./SettingsLayout";

export function UpdateSettingsPage({ client, onBack }: { client: ApplicationClient; onBack: () => void }) {
  const [status, setStatus] = useState<PiStationUpdateStatus>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let current = true;
    void client.getUpdateStatus().then((value) => { if (current) setStatus(value); }).catch((reason: unknown) => {
      if (current) setError(message(reason, "Could not check for updates."));
    });
    return () => { current = false; };
  }, [client]);

  const changeChannel = (channel: UpdateChannel): void => {
    setSaving(true); setError(""); setAccepted(false);
    void client.setUpdateChannel(channel).then(setStatus).catch((reason: unknown) => {
      setError(message(reason, "Could not save the update channel."));
    }).finally(() => setSaving(false));
  };

  const requestUpdate = (): void => {
    setRequesting(true); setError("");
    void client.requestUpdate().then(() => setAccepted(true)).catch((reason: unknown) => {
      setError(message(reason, "Could not start the update."));
    }).finally(() => setRequesting(false));
  };

  return <SettingsLayout title="Pi Station Update" description="Choose a release channel and install updates when you request them." onBack={onBack}>
    <Card className="settings-card bg-transparent">
      <CardHeader><CardTitle><RefreshCw aria-hidden="true" /> Software update</CardTitle><CardDescription>Pi Station does not install updates automatically.</CardDescription></CardHeader>
      <CardContent className="update-settings-content">
        <dl className="update-version-list">
          <div><dt>Installed version</dt><dd>{status?.currentVersion ?? "Checking…"}</dd></div>
          <div><dt>Latest version</dt><dd>{status?.latestVersion ?? (status?.latestVersionError === undefined ? "Checking…" : "Unavailable")}</dd></div>
        </dl>
        <div className="settings-field">
          <Label htmlFor="update-channel">Release channel</Label>
          <select id="update-channel" className="settings-select" value={status?.channel ?? "stable"} disabled={status === undefined || saving || requesting} onChange={(event) => changeChannel(event.target.value as UpdateChannel)}>
            <option value="stable">Stable</option>
            <option value="edge">Edge</option>
          </select>
          <p className="settings-note">Stable uses the latest published release. Edge uses the latest validated build and can contain unstable changes.</p>
        </div>
        {status?.latestVersionError !== undefined && <p role="alert" className="new-session-error">{status.latestVersionError}</p>}
        {error !== "" && <p role="alert" className="new-session-error">{error}</p>}
        {accepted && <p role="status" className="settings-message">Update requested. Pi Station will show maintenance status while the service restarts.</p>}
        <div className="settings-card-actions">
          <Button type="button" onClick={requestUpdate} disabled={status?.updateAvailable !== true || requesting || saving || accepted}>{requesting ? "Starting Update…" : status?.updateAvailable === false ? "Pi Station Is Up to Date" : "Update Pi Station"}</Button>
          <small>Updates wait for active Sessions before the service restarts.</small>
        </div>
      </CardContent>
    </Card>
  </SettingsLayout>;
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
