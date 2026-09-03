import { useEffect, useRef, useState } from "react";
import type { SavedWorkspace } from "../application/workspace-model";
import {
  Check,
  FolderKanban,
  FolderPlus,
  LayoutDashboard,
  Menu,
  Plus,
  Settings,
  X,
} from "lucide-react";

type MobileNavigationRoute = "dashboard" | "projects";

export function MobileNavigationMenu({
  current,
  onNewSession,
  onNewProject,
  onDashboard,
  onProjects,
  onSettings,
  workspaces = [],
  activeWorkspaceId,
  onWorkspace,
}: {
  current: MobileNavigationRoute;
  onNewSession: () => void;
  onNewProject: () => void;
  onDashboard: () => void;
  onProjects: () => void;
  onSettings: () => void;
  workspaces?: readonly SavedWorkspace[];
  activeWorkspaceId?: string | undefined;
  onWorkspace?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const run = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <div className="mobile-navigation" ref={containerRef}>
      <button
        className="mobile-navigation-trigger"
        type="button"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="mobile-navigation-menu"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        {open
          ? <X aria-hidden="true" size={20} />
          : <Menu aria-hidden="true" size={20} />}
      </button>
      {open && (
        <div className="mobile-navigation-menu" id="mobile-navigation-menu" role="menu">
          <div className="mobile-navigation-actions">
            <button type="button" role="menuitem" onClick={() => run(onNewSession)}>
              <Plus aria-hidden="true" size={17} />
              <span>New Session</span>
            </button>
            <button type="button" role="menuitem" onClick={() => run(onNewProject)}>
              <FolderPlus aria-hidden="true" size={17} />
              <span>New Project</span>
            </button>
          </div>
          {workspaces.length > 0 && onWorkspace !== undefined && <div className="mobile-navigation-workspaces">
            <span>Workspaces</span>
            {workspaces.map((workspace) => <button
              type="button"
              role="menuitem"
              key={workspace.id}
              aria-current={workspace.id === activeWorkspaceId ? "true" : undefined}
              onClick={() => run(() => onWorkspace(workspace.id))}
            >
              {workspace.id === activeWorkspaceId ? <Check aria-hidden="true" size={17} /> : <span className="mobile-navigation-workspace-spacer" />}
              <span>{workspace.name}</span>
            </button>)}
          </div>}
          <div className="mobile-navigation-links">
            <button
              type="button"
              role="menuitem"
              aria-current={current === "dashboard" ? "page" : undefined}
              onClick={() => run(onDashboard)}
            >
              <LayoutDashboard aria-hidden="true" size={17} />
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-current={current === "projects" ? "page" : undefined}
              onClick={() => run(onProjects)}
            >
              <FolderKanban aria-hidden="true" size={17} />
              <span>Projects</span>
            </button>
            <button type="button" role="menuitem" onClick={() => run(onSettings)}>
              <Settings aria-hidden="true" size={17} />
              <span>Settings</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
