import { useEffect, useState } from "react";
import { ArrowLeft, Folder, Plus } from "lucide-react";
import type { ProjectSummary, SessionKey } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export function NewSessionPage({ state, onBack, onListDirectory, onCreate, onStarted }: {
  state: ApplicationState;
  onBack: () => void;
  onListDirectory: (path?: string, showHidden?: boolean) => string | undefined;
  onCreate: (workingDirectory: string, optionalName?: string) => string | undefined;
  onStarted: (sessionKey: SessionKey) => void;
}) {
  const availableProjects = state.projects.filter((project) => project.available);
  const [source, setSource] = useState<"project" | "directory">(availableProjects.length > 0 ? "project" : "directory");
  const [project, setProject] = useState<ProjectSummary | undefined>(availableProjects[0]);
  const [directoryRequestId, setDirectoryRequestId] = useState<string>();
  const [showHidden, setShowHidden] = useState(false);
  const [name, setName] = useState("");
  const [createRequestId, setCreateRequestId] = useState<string>();
  const directoryRequest = directoryRequestId === undefined ? undefined : state.directoryLists[directoryRequestId];
  const directory = directoryRequest?.result?.status === "succeeded" ? directoryRequest.result : undefined;
  const createRequest = createRequestId === undefined ? undefined : state.managedSessionCreates[createRequestId];
  const starting = createRequest?.status === "starting";
  const error = createRequest?.result?.status === "outcome-unknown"
    ? "Pi may have started, but Pi Station has not confirmed the Session yet."
    : createRequest?.result?.status === "rejected" || createRequest?.result?.status === "retryable"
      ? createRequest.result.error.message
      : directoryRequest?.result?.status === "rejected" || directoryRequest?.result?.status === "retryable"
        ? directoryRequest.result.error.message : undefined;
  const loadDirectory = (path?: string, hidden = showHidden): void => { const id = onListDirectory(path, hidden); if (id !== undefined) setDirectoryRequestId(id); };
  useEffect(() => { if (source === "directory" && directoryRequestId === undefined) loadDirectory(undefined, showHidden); }, [source]);
  useEffect(() => { if (createRequest?.result?.status === "succeeded") onStarted(createRequest.result.sessionKey); }, [createRequest?.result, onStarted]);
  const workingDirectory = source === "project" ? project?.displayPath : directory?.current.path;

  return <main className="creation-page"><div className="creation-page-shell">
    <header className="creation-page-header"><Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Back to Workspace"><ArrowLeft aria-hidden="true" /></Button><div><h1>New Session</h1><p>Choose where Pi will work.</p></div></header>
    <Tabs value={source} onValueChange={(value) => setSource(value as "project" | "directory")}>
      <TabsList aria-label="Session source"><TabsTrigger value="project" disabled={starting || availableProjects.length === 0}>Project</TabsTrigger><TabsTrigger value="directory" disabled={starting}>Directory</TabsTrigger></TabsList>
    </Tabs>
    <div className="creation-page-content">
      <Card className="creation-picker gap-0 bg-transparent py-0">
        <CardHeader><CardTitle>{source === "project" ? "Projects" : "Directory"}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {source === "project" ? <div className="creation-list">{state.projects.map((item) => <button type="button" key={item.projectId} disabled={!item.available || starting} aria-pressed={project?.projectId === item.projectId} onClick={() => setProject(item)}><span className="creation-item-icon"><Folder aria-hidden="true" /></span><span><strong>{item.name}</strong><small>{item.displayPath}</small></span>{!item.available ? <Badge variant="outline">Unavailable</Badge> : project?.projectId === item.projectId ? <Badge>Selected</Badge> : null}</button>)}</div>
          : <><div className="creation-directory-header"><div><small>Current directory</small><strong>{directory?.current.name ?? "Loading…"}</strong><span>{directory?.current.displayPath ?? ""}</span></div><label><span>Show hidden</span><input type="checkbox" checked={showHidden} disabled={starting || directoryRequest?.status === "loading"} onChange={(event) => { const checked = event.target.checked; setShowHidden(checked); loadDirectory(directory?.current.path, checked); }} /></label></div><div className="creation-list" aria-live="polite">{directory?.parent && <DirectoryButton name="Parent directory" path={directory.parent.displayPath} disabled={starting} onClick={() => loadDirectory(directory.parent?.path)} />}{directory?.directories.map((item) => <DirectoryButton key={item.path} name={item.name} path={item.displayPath} disabled={starting} onClick={() => loadDirectory(item.path)} />)}</div>{directoryRequest?.status === "loading" && <p className="creation-state" role="status">Loading directories…</p>}</>}
        </CardContent>
      </Card>
      <Card className="creation-form-card bg-transparent"><CardHeader><CardTitle>Session details</CardTitle></CardHeader><CardContent><form className="creation-form" onSubmit={(event) => { event.preventDefault(); if (workingDirectory === undefined || starting) return; const trimmed = name.trim(); const id = onCreate(workingDirectory, trimmed === "" ? undefined : trimmed); if (id !== undefined) setCreateRequestId(id); }}><div className="creation-field"><Label htmlFor="session-name">Session name <span>(optional)</span></Label><Input id="session-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="off" placeholder="e.g. Release planning" disabled={starting} /></div>{error && <p className="new-session-error" role="alert">{error}</p>}<Button type="submit" disabled={workingDirectory === undefined || starting}><Plus aria-hidden="true" data-icon="inline-start" />{starting ? "Starting…" : "Start Pi"}</Button></form></CardContent></Card>
    </div>
  </div></main>;
}

function DirectoryButton({ name, path, disabled, onClick }: { name: string; path: string; disabled: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick}><span className="creation-item-icon"><Folder aria-hidden="true" /></span><span><strong>{name}</strong><small>{path}</small></span></button>; }
