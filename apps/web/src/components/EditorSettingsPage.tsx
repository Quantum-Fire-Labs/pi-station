import { useState } from "react";
import { FilePenLine } from "lucide-react";
import { readMarkdownVimMode, writeMarkdownVimMode } from "../editor-preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { SettingsLayout } from "./SettingsLayout";

export function EditorSettingsPage({ onBack }: { onBack: () => void }) {
  const [vimMode, setVimMode] = useState(readMarkdownVimMode);
  return <SettingsLayout title="Editor" description="Configure editing behavior on this device." onBack={onBack}>
    <Card className="settings-card bg-transparent"><CardHeader><CardTitle><FilePenLine aria-hidden="true" /> Markdown editor</CardTitle><CardDescription>Choose how shared Markdown files behave when you edit them.</CardDescription></CardHeader><CardContent><label className="settings-toggle-row"><span><strong>Vim motions</strong><small>Use Normal, Insert, and Visual modes in the Markdown editor.</small></span><input type="checkbox" role="switch" checked={vimMode} onChange={(event) => { setVimMode(event.target.checked); writeMarkdownVimMode(event.target.checked); }} /></label><p className="settings-note">This setting applies to shared Markdown files in the Workspace and in the standalone editor.</p></CardContent></Card>
  </SettingsLayout>;
}
