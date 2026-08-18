import type { ReactNode } from "react";
import { Bell, Bot, ChevronRight, Clock, FilePenLine, Mic, Palette } from "lucide-react";
import { Card, CardContent } from "./ui/card";
import { SettingsLayout } from "./SettingsLayout";

export type SettingsRoute = "notifications" | "themes" | "voice-messages" | "session-defaults" | "timezone" | "editor";

export function SettingsPage({ onBack, onOpen }: { onBack: () => void; onOpen: (route: SettingsRoute) => void }) {
  return (
    <SettingsLayout title="Settings" description="Configure Pi Station on this device." onBack={onBack}>
      <section className="settings-group" aria-labelledby="settings-general">
        <h2 id="settings-general">General</h2>
        <Card className="settings-link-card gap-0 bg-transparent py-0">
          <CardContent className="p-0">
            <SettingLink icon={<Bot aria-hidden="true" />} title="Session Defaults" description="Choose the model and thinking level for new Sessions." onClick={() => onOpen("session-defaults")} />
            <SettingLink icon={<FilePenLine aria-hidden="true" />} title="Editor" description="Configure editing behavior for shared Markdown files." onClick={() => onOpen("editor")} />
            <SettingLink icon={<Clock aria-hidden="true" />} title="Timezone" description="Set the local timezone for Scheduled Jobs." onClick={() => onOpen("timezone")} />
            <SettingLink icon={<Bell aria-hidden="true" />} title="Notifications" description="Choose when Pi Station sends completion notifications." onClick={() => onOpen("notifications")} />
            <SettingLink icon={<Mic aria-hidden="true" />} title="Voice Messages" description="Configure transcription and voice responses." onClick={() => onOpen("voice-messages")} />
            <SettingLink icon={<Palette aria-hidden="true" />} title="Themes" description="Choose how Pi Station looks on this device." onClick={() => onOpen("themes")} />
          </CardContent>
        </Card>
      </section>
    </SettingsLayout>
  );
}

function SettingLink({ icon, title, description, onClick }: { icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <button className="settings-link" type="button" onClick={onClick}>
      <span className="settings-link-icon">{icon}</span>
      <span className="settings-link-copy"><strong>{title}</strong><small>{description}</small></span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}
