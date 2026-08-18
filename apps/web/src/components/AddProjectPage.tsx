import { useEffect, useState } from "react";
import { ArrowLeft, Folder, Plus } from "lucide-react";
import type { ProjectId } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function AddProjectPage({ state, onBack, onListDirectory, onCreate, onCreated }: {
  state: ApplicationState;
  onBack: () => void;
  onListDirectory: (path?: string, showHidden?: boolean) => string | undefined;
  onCreate: (name: string, directory: string) => string | undefined;
  onCreated: (projectId: ProjectId) => void;
}) {
  const [directoryRequestId, setDirectoryRequestId] = useState<string>();
  const [showHidden, setShowHidden] = useState(false);
  const [name, setName] = useState("");
  const [createRequestId, setCreateRequestId] = useState<string>();
  const directoryRequest = directoryRequestId === undefined ? undefined : state.directoryLists[directoryRequestId];
  const directory = directoryRequest?.result?.status === "succeeded" ? directoryRequest.result : undefined;
  const createRequest = createRequestId === undefined ? undefined : state.projectCreates[createRequestId];
  const saving = createRequest?.status === "saving";
  const error = createRequest?.result?.status === "rejected" || createRequest?.result?.status === "retryable" ? createRequest.result.error.message : directoryRequest?.result?.status === "rejected" || directoryRequest?.result?.status === "retryable" ? directoryRequest.result.error.message : undefined;
  const loadDirectory = (path?: string, hidden = showHidden): void => { const id = onListDirectory(path, hidden); if (id !== undefined) setDirectoryRequestId(id); };
  useEffect(() => { loadDirectory(undefined, false); }, []);
  useEffect(() => { if (createRequest?.result?.status === "succeeded") onCreated(createRequest.result.project.projectId); }, [createRequest?.result, onCreated]);

  return <main className="creation-page"><div className="creation-page-shell">
    <header className="creation-page-header"><Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Back to Projects"><ArrowLeft aria-hidden="true" /></Button><div><h1>Add Project</h1><p>Choose a directory and name the Project.</p></div></header>
    <div className="creation-page-content">
      <Card className="creation-picker gap-0 bg-transparent py-0"><CardHeader><CardTitle>Project directory</CardTitle></CardHeader><CardContent className="p-0"><div className="creation-directory-header"><div><small>Selected directory</small><strong>{directory?.current.name ?? "Loading…"}</strong><span>{directory?.current.displayPath ?? ""}</span></div><label><span>Show hidden</span><input type="checkbox" checked={showHidden} disabled={saving || directoryRequest?.status === "loading"} onChange={(event) => { const checked = event.target.checked; setShowHidden(checked); loadDirectory(directory?.current.path, checked); }} /></label></div><div className="creation-list" aria-live="polite">{directory?.parent && <DirectoryButton name="Parent directory" path={directory.parent.displayPath} disabled={saving} onClick={() => loadDirectory(directory.parent?.path)} />}{directory?.directories.map((item) => <DirectoryButton key={item.path} name={item.name} path={item.displayPath} disabled={saving} onClick={() => loadDirectory(item.path)} />)}</div>{directoryRequest?.status === "loading" && <p className="creation-state" role="status">Loading directories…</p>}</CardContent></Card>
      <Card className="creation-form-card bg-transparent"><CardHeader><CardTitle>Project details</CardTitle></CardHeader><CardContent><form className="creation-form" onSubmit={(event) => { event.preventDefault(); const trimmed = name.trim(); if (trimmed === "" || directory === undefined || saving) return; const id = onCreate(trimmed, directory.current.path); if (id !== undefined) setCreateRequestId(id); }}><div className="creation-field"><Label htmlFor="project-name">Project name</Label><Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="off" placeholder="e.g. Pi Station" disabled={saving} required /></div>{error && <p className="new-session-error" role="alert">{error}</p>}<Button type="submit" disabled={name.trim() === "" || directory === undefined || saving}><Plus aria-hidden="true" data-icon="inline-start" />{saving ? "Saving…" : "Save Project"}</Button></form></CardContent></Card>
    </div>
  </div></main>;
}
function DirectoryButton({ name, path, disabled, onClick }: { name: string; path: string; disabled: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick}><span className="creation-item-icon"><Folder aria-hidden="true" /></span><span><strong>{name}</strong><small>{path}</small></span></button>; }
