import { useState } from "react";
import { ArrowLeft, Check, ChevronDown, Copy, ExternalLink, FileText, X } from "lucide-react";
import type { ProjectSummary, SessionSummary } from "../application/workspace-model";
import type { ApplicationState } from "../application/application-client-base";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Props = {
  state: ApplicationState;
  summary: SessionSummary;
  project?: ProjectSummary;
  bookmarked: boolean;
  bookmarkSaving: boolean;
  bookmarkError?: string;
  canCloseSession: boolean;
  canCloneSession: boolean;
  canReloadSession: boolean;
  canRestartSession: boolean;
  restartSaving: boolean;
  restartError?: string;
  canRenameSession: boolean;
  settingSaving: boolean;
  reloadSaving: boolean;
  reloadError?: string;
  onRequestCloseSession: () => void;
  onCloneSession: () => void;
  onReloadSession: () => void;
  onRestartSession: () => void;
  onRenameSession: (name: string) => void;
  onOpenProject: () => void;
  onNewSession: () => void;
  projects: readonly ProjectSummary[];
  onMoveSession: (projectId: string) => void;
  onCancelMove: () => void;
  onSetBookmark: (bookmarked: boolean) => void;
  developmentServer?: ApplicationState["developmentServers"][number];
  developmentServerOutput?: string;
  developmentServerPending: boolean;
  developmentServerError?: string;
  onStartDevelopmentServer: () => void;
  onStopDevelopmentServer: () => void;
  onViewDevelopmentServerOutput: () => void;
  onOpenSharedMarkdown: (file: { name: string; url: string }) => void;
};

export function SessionDetails(props: Props) {
  const { state, summary, project } = props;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [moveProjectId, setMoveProjectId] = useState(summary.projectId ?? "");
  const details = state.selected.details;
  const projection = state.selected.projection ?? summary.projection;
  const name = details?.name ?? summary.name ?? "Untitled Session";
  const directory = details?.currentDirectoryDisplay ?? summary.displayPath ?? "Unavailable";
  const status = projection.availability === "available" ? titleCase(projection.run) : titleCase(projection.availability);
  const management = projection.management.kind === "managed"
    ? `${titleCase(projection.management.processState)} · ${projection.management.runner}` : "Unmanaged";
  const updated = summary.lastActivityAt === undefined ? "Unavailable" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(summary.lastActivityAt));

  return (
    <SheetContent className="w-full gap-0 p-0 sm:max-w-[420px]" showCloseButton={false} aria-describedby="session-details-description">
      <SheetHeader className="session-details-header flex-row items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant={projection.run === "working" ? "default" : "secondary"}>{status}</Badge>
          <Badge variant="outline">{management}</Badge>
        </div>
        <Tooltip>
          <TooltipTrigger render={<SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Close Session details" />} />}>
            <X className="details-close-desktop" aria-hidden="true" />
            <ArrowLeft className="details-close-mobile" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Close Session details</TooltipContent>
        </Tooltip>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="session-details-content">
          <section className="session-details-overview">
            <div className="session-details-name">
              <SheetTitle id="session-details-title">{name}</SheetTitle>
              {props.canRenameSession && !editingName && (
                <Button variant="ghost" size="sm" disabled={props.settingSaving} onClick={() => {
                  setNameDraft(name); setEditingName(true);
                }}>Rename</Button>
              )}
            </div>
            <SheetDescription id="session-details-description">Session details for {directory}</SheetDescription>
            {editingName && (
              <form className="session-setting-form" onSubmit={(event) => {
                event.preventDefault(); const value = nameDraft.trim(); if (value === "") return;
                props.onRenameSession(value); setEditingName(false);
              }}>
                <label><span>Session name</span><Input value={nameDraft} maxLength={120} autoFocus onChange={(event) => setNameDraft(event.target.value)} /></label>
                <div><Button type="button" variant="outline" onClick={() => setEditingName(false)}>Cancel</Button><Button type="submit" disabled={nameDraft.trim() === "" || props.settingSaving}>Save</Button></div>
              </form>
            )}
          </section>
          <Separator />
          <dl className="session-details-facts">
            <div className="wide"><dt>Session ID</dt><dd className="session-details-id"><span>{summary.sessionKey.piSessionId}</span>
              <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={copyState === "copied" ? "Session ID copied" : "Copy Session ID"} onClick={() => {
                if (navigator.clipboard === undefined) return setCopyState("failed");
                void navigator.clipboard.writeText(summary.sessionKey.piSessionId).then(() => setCopyState("copied")).catch(() => setCopyState("failed"));
              }} />}>{copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</TooltipTrigger><TooltipContent>{copyState === "copied" ? "Copied" : "Copy Session ID"}</TooltipContent></Tooltip>
            </dd></div>
            <div><dt>Project</dt><dd>{project === undefined ? "Unavailable" : <Button variant="link" className="session-details-project-link h-auto p-0" onClick={props.onOpenProject}>{project.name}</Button>}</dd></div>
            <div><dt>Updated</dt><dd>{updated}</dd></div>
            <div className="wide"><dt>Management</dt><dd><Badge variant="outline">{management}</Badge></dd></div>
            {details?.managedLaunchDisplay !== undefined && <div className="wide"><dt>Launch</dt><dd>{details.managedLaunchDisplay}</dd></div>}
          </dl>

          {props.developmentServer?.configuration !== undefined && <>
            <Separator /><section className="session-details-section development-server-details">
              <h2>Development Server <Badge variant="secondary">{titleCase(props.developmentServer.lifecycle)}</Badge></h2>
              <p className="development-server-command">{props.developmentServer.configuration.command}</p>
              <div className="session-details-actions">
                {props.developmentServer.lifecycle === "running" ? <>
                  {props.developmentServer.previewUrl !== undefined && <Button render={<a href={props.developmentServer.previewUrl} target="_blank" rel="noreferrer" />} variant="outline">Open preview <ExternalLink aria-hidden="true" /></Button>}
                  <Button variant="outline" disabled={props.developmentServerPending} onClick={props.onViewDevelopmentServerOutput}>View output</Button>
                  <Button variant="outline" disabled={props.developmentServerPending} onClick={props.onStopDevelopmentServer}>Stop server</Button>
                </> : <><Button disabled={props.developmentServerPending} onClick={props.onStartDevelopmentServer}>Start server</Button><Button variant="outline" disabled={props.developmentServerPending} onClick={props.onViewDevelopmentServerOutput}>View output</Button></>}
              </div>
              {props.developmentServer.safeFailure !== undefined && <p role="alert">{props.developmentServer.safeFailure}</p>}
              {props.developmentServerError !== undefined && <p role="alert">{props.developmentServerError}</p>}
              {props.developmentServerOutput !== undefined && <pre aria-label="Development Server output">{props.developmentServerOutput || "No output captured."}</pre>}
            </section>
          </>}

          <Separator /><section className="session-details-section session-details-shared-files">
            <h2>Shared files <Badge variant="secondary">{details?.sharedFiles?.length ?? 0}</Badge></h2>
            {details?.sharedFiles !== undefined && details.sharedFiles.length > 0 ? <ul>{details.sharedFiles.map((file) => <li key={file.url}>
              {/\.(?:md|markdown)$/iu.test(file.name) ? <Button variant="outline" className="session-details-shared-file" onClick={() => props.onOpenSharedMarkdown(file)}><FileText aria-hidden="true" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span></Button>
                : <Button render={<a href={file.url} target="_blank" rel="noreferrer" />} variant="outline"><FileText aria-hidden="true" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><ExternalLink aria-hidden="true" /></Button>}
            </li>)}</ul> : <p>No shared files.</p>}
          </section>

          <Separator /><section className="session-details-section">
            <h2>Move Session</h2>
            {summary.pendingProjectMove === undefined ? (
              <form className="session-setting-form" onSubmit={(event) => {
                event.preventDefault();
                const target = props.projects.find((item) => item.projectId === moveProjectId);
                if (target === undefined) return;
                const timing = projection.run === "working" ? " after the current turn is complete" : " now";
                if (window.confirm(`Move this Session to ${target.name}${timing}?`)) props.onMoveSession(target.projectId);
              }}>
                <label><span>Destination Project</span>
                  <Select value={moveProjectId} onValueChange={(value) => setMoveProjectId(value ?? "")}>
                    <SelectTrigger className="w-full" aria-label="Move Session Project"><SelectValue /></SelectTrigger>
                    <SelectContent>{props.projects.filter((item) => item.available).map((item) => <SelectItem key={item.projectId} value={item.projectId}>{item.name}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <div><Button type="submit" disabled={moveProjectId === ""}>Move Session</Button></div>
              </form>
            ) : (
              <div><p role="status">Move scheduled for {summary.pendingProjectMove.projectName}.</p><Button type="button" variant="outline" onClick={props.onCancelMove}>Cancel scheduled move</Button></div>
            )}
          </section>

          <Separator /><section className="session-details-section"><h2>Actions</h2><div className="session-details-actions">
            {project !== undefined && <Button variant="outline" onClick={props.onNewSession}>New Session in Project</Button>}
            {project !== undefined && <Button variant="outline" disabled={props.bookmarkSaving} onClick={() => props.onSetBookmark(!props.bookmarked)}>{props.bookmarked ? "Remove Session Bookmark" : "Bookmark Session"}</Button>}
            {props.canCloneSession && <Button variant="outline" disabled={props.settingSaving} onClick={props.onCloneSession}>Clone Session</Button>}
            {props.canReloadSession && <Button variant="outline" disabled={props.reloadSaving} onClick={props.onReloadSession}>{props.reloadSaving ? "Reloading Pi Session…" : "Reload Pi Session"}</Button>}
            {props.canRestartSession && <Button variant="outline" disabled={props.restartSaving} onClick={props.onRestartSession}>{props.restartSaving ? "Restarting Session…" : "Restart Session"}</Button>}
            {props.canCloseSession && <Button variant="destructive" onClick={props.onRequestCloseSession}>Close Session</Button>}
          </div>
          {[props.bookmarkError, copyState === "failed" ? "Could not copy the Session ID." : undefined, props.reloadError, props.restartError].filter(Boolean).map((error) => <p role="alert" key={error}>{error}</p>)}
          </section>

          <DetailsCollapsible title="Environment" count={projection.capabilities.length}>{projection.capabilities.length > 0 ? <ul>{projection.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul> : <p>No capabilities reported.</p>}</DetailsCollapsible>
          <DetailsCollapsible title="Commands" count={details?.commandInventory.length ?? 0}>{details !== undefined && details.commandInventory.length > 0 ? <ul>{details.commandInventory.map((command) => <li key={`${command.source}:${command.name}`}><strong>{command.name}</strong>{command.description !== undefined && <span>{command.description}</span>}</li>)}</ul> : <p>No commands reported.</p>}</DetailsCollapsible>
        </div>
      </ScrollArea>
    </SheetContent>
  );
}

function DetailsCollapsible({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <><Separator /><Collapsible className="session-details-section"><CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-between px-0" />}><span>{title} <Badge variant="secondary">{count}</Badge></span><ChevronDown aria-hidden="true" /></CollapsibleTrigger><CollapsibleContent>{children}</CollapsibleContent></Collapsible></>;
}
function titleCase(value: string): string { return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`; }
function formatFileSize(bytes: number): string { if (bytes < 1_024) return `${bytes} B`; if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`; return `${(bytes / 1_048_576).toFixed(1)} MB`; }
