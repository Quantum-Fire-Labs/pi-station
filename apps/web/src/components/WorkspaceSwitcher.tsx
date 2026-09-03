import { useState, type ReactNode } from "react";
import { Check, MoreHorizontal, PanelsTopLeft, Pencil, Plus, Trash2, Zap } from "lucide-react";
import type { SavedWorkspace } from "../application/workspace-model";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, onActivate, onCreate, onRename, onDelete, onOpenQuickSession, onNewSession, children }: {
  workspaces: readonly SavedWorkspace[];
  activeWorkspaceId?: string | undefined;
  onActivate: (id: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenQuickSession: () => void;
  onNewSession: () => void;
  children: ReactNode;
}) {
  const active = workspaces.find(({ id }) => id === activeWorkspaceId) ?? workspaces[0];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(undefined);
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Workspace could not be changed."); }
    finally { setBusy(false); }
  };
  const create = (): void => {
    const value = name.trim();
    if (value === "") return;
    void run(async () => { await onCreate(value); setName(""); setCreating(false); });
  };
  return <div className={`workspace-switcher${workspaces.length === 0 ? " empty" : ""}`} aria-label="Workspaces">
    {workspaces.length > 0 && <><span className="workspace-list-label">Workspaces</span><nav className="workspace-list" aria-label="Saved Workspaces">
      {workspaces.map((workspace) => {
        const selected = workspace.id === active?.id;
        return <button
          type="button"
          key={workspace.id}
          className={selected ? "selected" : undefined}
          aria-current={selected ? "true" : undefined}
          disabled={busy}
          onClick={() => { if (!selected) void run(() => onActivate(workspace.id)); }}
        >
          {selected ? <Check aria-hidden="true" size={15} /> : <PanelsTopLeft aria-hidden="true" size={15} />}
          <span>{workspace.name}</span>
        </button>;
      })}
    </nav></>}
    <section className="workspace-active-panel" aria-label={active === undefined ? "All Projects" : `Active Workspace: ${active.name}`}>
      <header className="workspace-active-header">
        <strong>{active?.name ?? "All Projects"}</strong>
        {active && <DropdownMenu>
          <DropdownMenuTrigger className="workspace-actions-trigger" disabled={busy} aria-label={`Actions for ${active.name}`}>
            <MoreHorizontal aria-hidden="true" size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpenQuickSession}><Zap aria-hidden="true" />Quick Session</DropdownMenuItem>
            <DropdownMenuItem onClick={onNewSession}><Plus aria-hidden="true" />New Session</DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const value = window.prompt("Rename Workspace", active.name)?.trim();
              if (value) void run(() => onRename(active.id, value));
            }}><Pencil aria-hidden="true" />Rename Workspace</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => {
              if (!window.confirm(`Delete Workspace “${active.name}”? Projects and Sessions will not be deleted.`)) return;
              void run(() => onDelete(active.id));
            }}><Trash2 aria-hidden="true" />Delete Workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </header>
      <div className="workspace-active-content">{children}</div>
    </section>
    {creating ? <form className="workspace-create-form" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label><span className="sr-only">Workspace name</span><input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" /></label>
      <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>Create</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setName(""); }}>Cancel</Button>
    </form> : <button className="workspace-create-trigger" type="button" onClick={() => setCreating(true)} disabled={busy}>
      <Plus aria-hidden="true" size={15} />New Workspace
    </button>}
    {error && <p className="workspace-switcher-error" role="alert">{error}</p>}
  </div>;
}
