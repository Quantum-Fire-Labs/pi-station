import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArchiveRestore, Check, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { SavedWorkspace } from "../application/workspace-model";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, onActivate, onCreate, onRename, onDelete, onCloseWorkspace, onRestoreWorkspace, onOpenQuickSession, onNewSession, children }: {
  workspaces: readonly SavedWorkspace[];
  activeWorkspaceId?: string | undefined;
  onActivate: (id: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCloseWorkspace: (id: string) => Promise<void>;
  onRestoreWorkspace: (id: string) => Promise<void>;
  onOpenQuickSession: () => void;
  onNewSession: () => void;
  children: ReactNode;
}) {
  const open = workspaces.filter(({ closedAt }) => closedAt === undefined);
  const closed = workspaces.filter(({ closedAt }) => closedAt !== undefined);
  const active = open.find(({ id }) => id === activeWorkspaceId) ?? open[0];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [createdWorkspace, setCreatedWorkspace] = useState<{ readonly name: string; readonly previousIds: ReadonlySet<string> }>();
  const activatingCreatedWorkspace = useRef(false);
  useEffect(() => {
    if (createdWorkspace === undefined || activatingCreatedWorkspace.current) return;
    const created = workspaces.find((workspace) => !createdWorkspace.previousIds.has(workspace.id) && workspace.name === createdWorkspace.name);
    if (created === undefined) return;
    activatingCreatedWorkspace.current = true;
    void run(() => onActivate(created.id)).finally(() => {
      activatingCreatedWorkspace.current = false;
      setCreatedWorkspace(undefined);
    });
  }, [createdWorkspace, workspaces]);
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(undefined);
    try { await operation(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Workspace could not be changed."); }
    finally { setBusy(false); }
  };
  const create = (): void => {
    const value = name.trim();
    if (value === "") return;
    const previousIds = new Set(workspaces.map(({ id }) => id));
    void run(async () => { await onCreate(value); setCreatedWorkspace({ name: value, previousIds }); setName(""); setCreating(false); });
  };
  return <div className={`workspace-switcher${open.length === 0 ? " empty" : ""}`} aria-label="Workspaces">
    <div className="workspace-picker-row">
      <DropdownMenu>
        <DropdownMenuTrigger className="workspace-picker" disabled={busy} aria-label="Select Workspace"><span>{active?.name ?? "Select Workspace"}</span><ChevronDown aria-hidden="true" size={15} /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="workspace-picker-menu">
          {open.map((workspace) => <DropdownMenuItem key={workspace.id} onClick={() => { if (workspace.id !== active?.id) void run(() => onActivate(workspace.id)); }}>{workspace.id === active?.id && <Check aria-hidden="true" />}<span>{workspace.name}</span></DropdownMenuItem>)}
          <DropdownMenuItem onClick={() => setCreating(true)}><Plus aria-hidden="true" />New Workspace</DropdownMenuItem>
          {closed.length > 0 && <><div className="workspace-picker-section">Closed</div>{closed.map((workspace) => <DropdownMenuItem key={workspace.id} onClick={() => void run(async () => { await onRestoreWorkspace(workspace.id); await onActivate(workspace.id); })}><ArchiveRestore aria-hidden="true" /><span>{workspace.name}</span></DropdownMenuItem>)}</>}
        </DropdownMenuContent>
      </DropdownMenu>
      {active && <DropdownMenu>
        <DropdownMenuTrigger className="workspace-actions-trigger" disabled={busy} aria-label={`Actions for ${active.name}`}><MoreHorizontal aria-hidden="true" size={16} /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpenQuickSession}>Quick Session</DropdownMenuItem>
          <DropdownMenuItem onClick={onNewSession}><Plus aria-hidden="true" />New Session</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { const value = window.prompt("Rename Workspace", active.name)?.trim(); if (value) void run(() => onRename(active.id, value)); }}><Pencil aria-hidden="true" />Rename Workspace</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run(() => onCloseWorkspace(active.id))}><X aria-hidden="true" />Close Workspace</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => { if (window.confirm(`Delete Workspace “${active.name}”? Sessions will not be deleted.`)) void run(() => onDelete(active.id)); }}><Trash2 aria-hidden="true" />Delete Workspace</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
    {creating && <form className="workspace-create-form" onSubmit={(event) => { event.preventDefault(); create(); }}><label><span className="sr-only">Workspace name</span><input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" /></label><Button type="submit" size="sm" disabled={busy || name.trim() === ""}>Create</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setCreating(false); setName(""); }}>Cancel</Button></form>}
    {active && <section className="workspace-active-panel" aria-label={`Active Workspace: ${active.name}`}><div className="workspace-active-content">{children}</div></section>}
    {error && <p className="workspace-switcher-error" role="alert">{error}</p>}
  </div>;
}
