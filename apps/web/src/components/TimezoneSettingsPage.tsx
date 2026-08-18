import { useEffect, useState } from "react";
import type { ApplicationClient } from "../application/application-client";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { SettingsLayout } from "./SettingsLayout";

export function TimezoneSettingsPage({ client, onBack }: { client?: ApplicationClient | undefined; onBack: () => void }) {
  const [timezone, setTimezone] = useState(""); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
  useEffect(() => { void client?.getPiStationSettings().then((value) => setTimezone(value.timezone)).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load timezone")); }, [client]);
  return <SettingsLayout title="Timezone" description="Set the local timezone for Scheduled Jobs." onBack={onBack}><Card className="settings-card bg-transparent"><CardHeader><CardTitle>Local timezone</CardTitle><CardDescription>Scheduled Jobs use this IANA timezone for local dates and times.</CardDescription></CardHeader><CardContent><form className="settings-form" onSubmit={(event) => { event.preventDefault(); setError(""); setSaved(false); void client?.setPiStationTimezone(timezone.trim()).then((value) => { setTimezone(value.timezone); setSaved(true); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save timezone")); }}><div className="settings-field"><Label htmlFor="timezone">IANA timezone</Label><Input id="timezone" required value={timezone} placeholder="America/New_York" onChange={(event) => setTimezone(event.target.value)} /></div><Button type="submit">Save Timezone</Button>{saved && <p role="status" className="settings-message">Timezone saved.</p>}{error && <p role="alert" className="new-session-error">{error}</p>}</form></CardContent></Card></SettingsLayout>;
}
