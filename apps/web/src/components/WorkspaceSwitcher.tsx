import { useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import type { SavedWorkspace } from "../application/workspace-model";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, onActivate, onCreate, onRename, onDelete }: {
  workspaces: readonly SavedWorkspace[];
  activeWorkspaceId?: string | undefined;
  onActivate: (id: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
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
  return <div className="workspace-switcher">
    <DropdownMenu>
      <DropdownMenuTrigger className="workspace-switcher-trigger" disabled={busy} aria-label="Switch Workspace">
        <span><small>Workspace</small><strong>{active?.name ?? "All Projects"}</strong></span>
        <ChevronDown aria-hidden="true" size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-switcher-menu" align="start">
        <div className="workspace-menu-label">Saved Workspaces</div>
        {workspaces.map((workspace) => <DropdownMenuItem key={workspace.id} onClick={() => void run(() => onActivate(workspace.id))}>
          {workspace.id === active?.id ? <Check aria-hidden="true" /> : <span className="workspace-menu-spacer" />}
          <span>{workspace.name}</span>
        </DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setCreating(true)}><Plus aria-hidden="true" />New Workspace</DropdownMenuItem>
        <DropdownMenuItem disabled={active === undefined} onClick={() => {
          if (active === undefined) return;
          const value = window.prompt("Rename Workspace", active.name)?.trim();
          if (value) void run(() => onRename(active.id, value));
        }}><Pencil aria-hidden="true" />Rename Workspace</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={active === undefined} onClick={() => {
          if (active === undefined || !window.confirm(`Delete Workspace “${active.name}”? Projects and Sessions will not be deleted.`)) return;
          void run(() => onDelete(active.id));
        }}><Trash2 aria-hidden="true" />Delete Workspace</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {creating && <form className="workspace-create-form" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label><span className="sr-only">Workspace name</span><input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" /></label>
      <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>Create</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setName(""); }}>Cancel</Button>
    </form>}
    {error && <p className="workspace-switcher-error" role="alert">{error}</p>}
  </div>;
}
