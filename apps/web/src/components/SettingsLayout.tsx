import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";

export function SettingsLayout({ title, description, onBack, actions, children }: {
  title: string;
  description?: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="settings-page">
      <div className="settings-page-shell">
        <header className="settings-page-header">
          <div className="settings-page-heading">
            <Button className="settings-page-back" type="button" variant="outline" size="icon" onClick={onBack} aria-label={title === "Settings" ? "Back to Workspace" : "Back to Settings"}>
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div>
              <h1>{title}</h1>
              {description !== undefined && <p>{description}</p>}
            </div>
          </div>
          {actions !== undefined && <div className="settings-page-actions">{actions}</div>}
        </header>
        <div className="settings-page-content">{children}</div>
      </div>
    </main>
  );
}
