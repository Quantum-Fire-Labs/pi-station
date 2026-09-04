import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Workspace } from "@pi-station/application-protocol";
import { ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import type { SessionSummary } from "../application/workspace-model";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Modal } from "./Modal";
import "./workspace-row.css";

export interface WorkspaceActivity {
  readonly working: number;
  readonly unread: number;
}

function sessionIdentity(session: SessionSummary): string {
  return `${session.sessionKey.hostId}\0${session.sessionKey.piSessionId}`;
}

/** Counts each referenced Session and recursive descendant once by complete Session identity. */
export function workspaceActivity(workspace: Workspace, sessions: readonly SessionSummary[]): WorkspaceActivity {
  const included = new Set<string>();
  const queue: SessionSummary[] = [];
  for (const tab of workspace.tabs) {
    for (const session of sessions) {
      if (session.sessionKey.hostId === tab.projectId && session.sessionKey.piSessionId === tab.sessionId) queue.push(session);
    }
  }
  while (queue.length > 0) {
    const session = queue.shift()!;
    const key = sessionIdentity(session);
    if (included.has(key)) continue;
    included.add(key);
    for (const candidate of sessions) {
      if (candidate.parentSessionKey !== undefined
        && candidate.parentSessionKey.hostId === session.sessionKey.hostId
        && candidate.parentSessionKey.piSessionId === session.sessionKey.piSessionId) queue.push(candidate);
    }
  }
  let working = 0;
  let unread = 0;
  for (const session of sessions) {
    if (!included.has(sessionIdentity(session))) continue;
    if (session.projection.run === "working" || session.delegationStatus === "working") working += 1;
    if (session.projection.unread.hasUnread) unread += 1;
  }
  return { working, unread };
}

type Dialog = { readonly kind: "create" } | { readonly kind: "rename"; readonly workspace: Workspace }
  | { readonly kind: "closed" } | { readonly kind: "delete"; readonly workspace: Workspace };

export function WorkspaceRow({ workspaces, activeWorkspaceId, sessions, onActivate, onCreate, onRename, onClose, onRestore, onDelete }: {
  workspaces: readonly Workspace[];
  activeWorkspaceId?: string | undefined;
  sessions: readonly SessionSummary[];
  onActivate: (id: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const open = workspaces.filter((workspace) => workspace.closedAt === undefined);
  const closed = workspaces.filter((workspace) => workspace.closedAt !== undefined);
  const [dialog, setDialog] = useState<Dialog>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const element = activeRef.current;
    if (element !== null && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeWorkspaceId]);

  const run = async (operation: () => Promise<void>, closeOnSuccess = false): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      if (mounted.current && closeOnSuccess) { setDialog(undefined); setName(""); }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Workspace could not be changed.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const submitName = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = name.trim();
    if (value === "" || dialog === undefined) return;
    if (dialog.kind === "create") void run(() => onCreate(value), true);
    if (dialog.kind === "rename") void run(() => onRename(dialog.workspace.id, value), true);
  };
  const openDialog = (next: Dialog): void => {
    setError(undefined);
    setName(next.kind === "rename" ? next.workspace.name : "");
    setDialog(next);
  };
  const closeDialog = (): void => { setDialog(undefined); setName(""); setError(undefined); };

  return <>
    <nav className="workspace-row" aria-label="Workspaces">
      <div className="workspace-row-tabs" data-testid="workspace-row-scroll">
        {open.map((workspace) => {
          const active = workspace.id === activeWorkspaceId;
          const activity = workspaceActivity(workspace, sessions);
          return <div className={`workspace-row-tab${active ? " active" : ""}`} key={workspace.id}>
            <button ref={active ? activeRef : undefined} type="button" className="workspace-row-activate" aria-current={active ? "page" : undefined} disabled={busy} onClick={() => { if (!active) void run(() => onActivate(workspace.id)); }}>
              <span className="workspace-row-name" title={workspace.name}>{workspace.name}</span>
              {(activity.working > 0 || activity.unread > 0) && <span className="workspace-row-status">
                {activity.working > 0 && <span>{activity.working} working</span>}
                {activity.unread > 0 && <span>{activity.unread} unread</span>}
              </span>}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="workspace-row-menu-trigger" disabled={busy} aria-label={`Actions for ${workspace.name}`}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openDialog({ kind: "rename", workspace })}><Pencil aria-hidden="true" />Rename</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void run(() => onClose(workspace.id))}><X aria-hidden="true" />Close</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>;
        })}
      </div>
      <button type="button" className="workspace-row-control" disabled={busy} aria-label="Create Workspace" onClick={() => openDialog({ kind: "create" })}><Plus aria-hidden="true" /></button>
      <button type="button" className="workspace-row-closed" disabled={busy} onClick={() => openDialog({ kind: "closed" })}>Closed{closed.length > 0 ? ` (${closed.length})` : ""}</button>
    </nav>
    {dialog === undefined && error && <div className="workspace-row-inline-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss Workspace error" onClick={() => setError(undefined)}>Dismiss</button></div>}

    <Modal open={dialog?.kind === "create" || dialog?.kind === "rename"} title={dialog?.kind === "rename" ? "Rename Workspace" : "Create Workspace"} initialFocus={nameRef} busy={busy} onClose={closeDialog} onSubmit={submitName} actions={<><Button type="button" variant="ghost" disabled={busy} onClick={closeDialog}>Cancel</Button><Button type="submit" disabled={busy || name.trim() === ""}>{dialog?.kind === "rename" ? "Rename" : "Create"}</Button></>}>
      <label className="workspace-row-field"><span>Workspace name</span><input ref={nameRef} maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      {error && <p className="workspace-row-error" role="alert">{error}</p>}
    </Modal>

    <Modal open={dialog?.kind === "closed"} title="Closed Workspaces" description="Restore a Workspace or permanently delete it." busy={busy} onClose={closeDialog} actions={<Button type="button" variant="ghost" disabled={busy} onClick={closeDialog}>Done</Button>}>
      {closed.length === 0 ? <p>No closed Workspaces.</p> : <ul className="workspace-row-closed-list">{closed.map((workspace) => <li key={workspace.id}><span>{workspace.name}</span><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => onRestore(workspace.id), true)}><ArchiveRestore aria-hidden="true" />Restore</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => openDialog({ kind: "delete", workspace })}><Trash2 aria-hidden="true" />Delete</Button></li>)}</ul>}
      {error && <p className="workspace-row-error" role="alert">{error}</p>}
    </Modal>

    <Modal open={dialog?.kind === "delete"} title="Delete Workspace" {...(dialog?.kind === "delete" ? { description: `Delete “${dialog.workspace.name}” permanently? Sessions will not be deleted.` } : {})} busy={busy} onClose={closeDialog} actions={<><Button type="button" variant="ghost" disabled={busy} onClick={closeDialog}>Cancel</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => { if (dialog?.kind === "delete") void run(() => onDelete(dialog.workspace.id), true); }}>Delete</Button></>}>
      {error && <p className="workspace-row-error" role="alert">{error}</p>}
    </Modal>
  </>;
}
