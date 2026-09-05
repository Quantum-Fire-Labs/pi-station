import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Bookmark,
  Bot,
  Copy,
  Brain,
  Folder,
  FolderKanban,
  FolderPlus,
  History,
  Hash,
  Info,
  LayoutDashboard,
  PanelsTopLeft,
  Pencil,
  Plus,
  Search,
  Square,
  Archive,
  X,
} from "lucide-react";
import type { MessageStash } from "@pi-station/application-protocol";
import type { ApplicationState } from "../application/application-client-base";
import type { ModelChoice, ProjectId, ProjectSummary, SavedWorkspace, SessionKey, ThinkingLevel } from "../application/workspace-model";

interface PaletteAction {
  glyph: ReactNode;
  name: string;
  run: () => void;
}

export interface PaletteSession {
  readonly id: string;
  readonly name: string;
  readonly projectId?: ProjectId | undefined;
  readonly projectName?: string | undefined;
  readonly bookmarked?: boolean | undefined;
  readonly closed: boolean;
}

export type CommandPaletteInitialFlow = "actions" | "stashes";
type NewSessionLocation = { path: string; displayPath: string };
type Flow =
  | { kind: "actions" }
  | { kind: "rename"; value: string }
  | { kind: "model" }
  | { kind: "thinking" }
  | { kind: "sessions"; projectId?: ProjectId; projectName?: string; projectPath?: string }
  | { kind: "projects" }
  | { kind: "workspaces" }
  | { kind: "stashes" }
  | { kind: "close" }
  | { kind: "new-location" }
  | { kind: "new-project" }
  | { kind: "new-directory"; purpose: "session" | "project" }
  | { kind: "new-name"; location: NewSessionLocation; back: "actions" | "new-project" | "new-directory" }
  | { kind: "add-project-name"; location: NewSessionLocation };

export interface CommandPaletteProps {
  onClose: () => void;
  initialFlow?: CommandPaletteInitialFlow;
  sessionName?: string | undefined;
  sessionId?: string | undefined;
  projectName?: string | undefined;
  projectPath?: string | undefined;
  projects?: readonly ProjectSummary[] | undefined;
  projectBookmarkIds?: readonly ProjectId[] | undefined;
  workspaces?: readonly SavedWorkspace[] | undefined;
  activeWorkspaceId?: string | undefined;
  directoryLists?: ApplicationState["directoryLists"] | undefined;
  managedSessionCreates?: ApplicationState["managedSessionCreates"] | undefined;
  projectCreates?: ApplicationState["projectCreates"] | undefined;
  bookmarked?: boolean;
  working?: boolean;
  canCreateSession?: boolean;
  canAbort?: boolean;
  canClose?: boolean;
  canClone?: boolean;
  canRename?: boolean;
  canChangeModel?: boolean;
  canChangeThinking?: boolean;
  models?: readonly ModelChoice[] | undefined;
  thinkingLevels?: readonly ThinkingLevel[] | undefined;
  currentModel?: ModelChoice | undefined;
  currentThinking?: ThinkingLevel | undefined;
  sessions?: readonly PaletteSession[] | undefined;
  stashes?: readonly MessageStash[] | undefined;
  pending?: boolean | undefined;
  error?: string | undefined;
  onDashboard: () => void;
  onProjects: () => void;
  onAddProject: () => void;
  onCreateProject?: ((name: string, directory: string) => string | undefined) | undefined;
  onProjectCreated?: ((projectId: ProjectId) => void) | undefined;
  onListDirectory?: ((path?: string, showHidden?: boolean) => string | undefined) | undefined;
  onCreateSession?: ((workingDirectory: string, optionalName?: string) => string | undefined) | undefined;
  onSessionStarted?: ((sessionKey: SessionKey) => void) | undefined;
  onOpenProject?: (() => void) | undefined;
  onSessionDetails?: (() => void) | undefined;
  onRename?: ((name: string) => void) | undefined;
  onSetModel?: ((provider: string, modelId: string) => void) | undefined;
  onSetThinking?: ((level: ThinkingLevel) => void) | undefined;
  onOpenSession?: ((id: string) => void) | undefined;
  onSelectWorkspace?: ((id: string) => void) | undefined;
  onRestoreStash?: ((stash: MessageStash) => void) | undefined;
  onSetBookmark?: ((bookmarked: boolean) => void) | undefined;
  onClone?: (() => void) | undefined;
  onAbort?: (() => void) | undefined;
  onConfirmClose?: (() => void) | undefined;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [flow, setFlow] = useState<Flow>({ kind: props.initialFlow ?? "actions" });
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [directoryRequestId, setDirectoryRequestId] = useState<string>();
  const [showHidden, setShowHidden] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [createRequestId, setCreateRequestId] = useState<string>();
  const [projectCreateRequestId, setProjectCreateRequestId] = useState<string>();
  const [newSessionLaunchError, setNewSessionLaunchError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const closeAfter = (action: (() => void) | undefined): void => { action?.(); props.onClose(); };
  const startNameFlow = (location: NewSessionLocation, back: "actions" | "new-project" | "new-directory"): void => {
    setNewSessionName("");
    setCreateRequestId(undefined);
    setNewSessionLaunchError(undefined);
    setFlow({ kind: "new-name", location, back });
  };
  const loadDirectory = (path?: string, hidden = showHidden): void => {
    setActiveIndex(0);
    setNewSessionLaunchError(undefined);
    const id = props.onListDirectory?.(path, hidden);
    if (id === undefined) setNewSessionLaunchError("Pi Station could not load directories.");
    else setDirectoryRequestId(id);
  };
  const openDirectory = (purpose: "session" | "project" = "session"): void => {
    setDirectoryRequestId(undefined);
    setShowHidden(false);
    setQuery("");
    setFlow({ kind: "new-directory", purpose });
    loadDirectory(undefined, false);
  };
  const actions = useMemo<readonly PaletteAction[]>(() => {
    const items: PaletteAction[] = [
      { glyph: <LayoutDashboard aria-hidden="true" size={16} />, name: "Dashboard", run: () => closeAfter(props.onDashboard) },
      { glyph: <FolderKanban aria-hidden="true" size={16} />, name: "Projects", run: () => { setFlow({ kind: "projects" }); setQuery(""); } },
      { glyph: <FolderPlus aria-hidden="true" size={16} />, name: "Add Project", run: () => openDirectory("project") },
    ];
    if (props.onOpenSession) items.push({ glyph: <History aria-hidden="true" size={16} />, name: "Sessions", run: () => { setFlow({ kind: "sessions" }); setQuery(""); } });
    if (props.workspaces?.length && props.onSelectWorkspace) items.push({ glyph: <PanelsTopLeft aria-hidden="true" size={16} />, name: "Workspaces", run: () => { setFlow({ kind: "workspaces" }); setQuery(""); } });
    if (props.sessionId && props.onRestoreStash) items.push({ glyph: <Archive aria-hidden="true" size={16} />, name: "Stashed messages", run: () => { setFlow({ kind: "stashes" }); setQuery(""); } });
    if (props.canCreateSession && props.onCreateSession) items.push({ glyph: <Plus aria-hidden="true" size={16} />, name: "New Session", run: () => setFlow({ kind: "new-location" }) });
    if (props.projectName && props.onOpenProject) items.push({ glyph: <FolderKanban aria-hidden="true" size={16} />, name: `Open Project: ${props.projectName}`, run: () => closeAfter(props.onOpenProject) });
    if (props.projectName && props.projectPath && props.canCreateSession && props.onCreateSession) items.push({ glyph: <Plus aria-hidden="true" size={16} />, name: `New Session in ${props.projectName}`, run: () => startNameFlow({ path: props.projectPath!, displayPath: props.projectPath! }, "actions") });
    if (props.onSessionDetails) items.push({ glyph: <Info aria-hidden="true" size={16} />, name: "Session details", run: () => closeAfter(props.onSessionDetails) });
    if (props.canClone && props.onClone) items.push({ glyph: <Copy aria-hidden="true" size={16} />, name: "Clone Session", run: () => closeAfter(props.onClone) });
    if (props.canRename && props.onRename) items.push({ glyph: <Pencil aria-hidden="true" size={16} />, name: "Rename Session", run: () => setFlow({ kind: "rename", value: props.sessionName ?? "" }) });
    if (props.canChangeModel && props.models?.length && props.onSetModel) items.push({ glyph: <Bot aria-hidden="true" size={16} />, name: "Change model", run: () => setFlow({ kind: "model" }) });
    if (props.canChangeThinking && props.thinkingLevels?.length && props.onSetThinking) items.push({ glyph: <Brain aria-hidden="true" size={16} />, name: "Change thinking level", run: () => setFlow({ kind: "thinking" }) });
    if (props.sessionId) items.push({ glyph: <Hash aria-hidden="true" size={16} />, name: "Copy Session ID", run: () => { void navigator.clipboard?.writeText(props.sessionId!).then(props.onClose).catch(() => undefined); } });
    if (props.projectName && props.onSetBookmark) items.push({ glyph: <Bookmark aria-hidden="true" size={16} />, name: props.bookmarked ? "Remove Session Bookmark" : "Bookmark Session", run: () => closeAfter(() => props.onSetBookmark?.(!props.bookmarked)) });
    if (props.working && props.canAbort && props.onAbort) items.push({ glyph: <Square aria-hidden="true" size={15} />, name: "Abort", run: () => closeAfter(props.onAbort) });
    if (props.canClose && props.onConfirmClose) items.push({ glyph: <X aria-hidden="true" size={16} />, name: "Close Session", run: () => setFlow({ kind: "close" }) });
    return items;
  }, [props]);
  const shownActions = useMemo(() => actions.filter(({ name }) => name.toLowerCase().includes(query.toLowerCase())), [actions, query]);
  const availableProjects = props.projects?.filter((project) => project.available) ?? [];
  const shownProjects = flow.kind === "new-project" ? availableProjects.filter((project) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return project.name.toLocaleLowerCase().includes(normalizedQuery) || project.displayPath.toLocaleLowerCase().includes(normalizedQuery);
  }).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })) : [];
  const locationChoices = ["projects", "directories"] as const;
  const choices = flow.kind === "model" ? props.models ?? [] : flow.kind === "thinking" ? props.thinkingLevels ?? [] : [];
  const shownPaletteProjects = useMemo(() => {
    if (flow.kind !== "projects") return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const bookmarked = new Set(props.projectBookmarkIds ?? []);
    return [...(props.projects ?? [])]
      .filter((project) => project.name.toLocaleLowerCase().includes(normalizedQuery)
        || project.displayPath.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => Number(bookmarked.has(right.projectId)) - Number(bookmarked.has(left.projectId))
        || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [flow.kind, props.projectBookmarkIds, props.projects, query]);
  const shownSessions = useMemo(() => {
    if (flow.kind !== "sessions") return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...(props.sessions ?? [])]
      .filter((session) => flow.projectId === undefined || session.projectId === flow.projectId)
      .filter((session) => flow.projectId !== undefined || session.name.trim().length > 0)
      .filter((session) => session.name.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => sessionPaletteRank(left) - sessionPaletteRank(right)
        || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
        || (left.projectName ?? "").localeCompare(right.projectName ?? "", undefined, { sensitivity: "base" }));
  }, [flow, props.sessions, query]);
  const shownWorkspaces = flow.kind === "workspaces" ? (props.workspaces ?? []).filter((workspace) => (
    workspace.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )) : [];
  const shownStashes = flow.kind === "stashes" ? [...(props.stashes ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const closeChoices = [
    { glyph: <ArrowLeft aria-hidden="true" size={16} />, name: "Keep Session open", danger: false },
    { glyph: <X aria-hidden="true" size={16} />, name: props.working ? "Stop work and close Session" : "Close Session", danger: true },
  ] as const;
  const directoryRequest = directoryRequestId === undefined ? undefined : props.directoryLists?.[directoryRequestId];
  const directory = directoryRequest?.result?.status === "succeeded" ? directoryRequest.result : undefined;
  const shownDirectories = directory === undefined ? [] : directory.directories.filter((item) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return item.name.toLocaleLowerCase().includes(normalizedQuery) || item.displayPath.toLocaleLowerCase().includes(normalizedQuery);
  });
  const directoryChoiceCount = directory === undefined ? 0 : 1 + (directory.parent === undefined ? 0 : 1) + shownDirectories.length;
  const count = flow.kind === "actions" ? shownActions.length : flow.kind === "projects" ? shownPaletteProjects.length : flow.kind === "sessions" ? shownSessions.length : flow.kind === "workspaces" ? shownWorkspaces.length : flow.kind === "stashes" ? shownStashes.length : flow.kind === "close" ? closeChoices.length : flow.kind === "new-location" ? locationChoices.length : flow.kind === "new-project" ? shownProjects.length : flow.kind === "new-directory" ? directoryChoiceCount : choices.length;
  const createRequest = createRequestId === undefined ? undefined : props.managedSessionCreates?.[createRequestId];
  const projectCreateRequest = projectCreateRequestId === undefined ? undefined : props.projectCreates?.[projectCreateRequestId];
  const starting = createRequest?.status === "starting";
  const savingProject = projectCreateRequest?.status === "saving";
  const newSessionError = createRequest?.result?.status === "outcome-unknown"
    ? "Pi may have started, but Pi Station has not confirmed the Session yet."
    : createRequest?.result?.status === "rejected" || createRequest?.result?.status === "retryable"
      ? createRequest.result.error.message
      : directoryRequest?.result?.status === "rejected" || directoryRequest?.result?.status === "retryable"
        ? directoryRequest.result.error.message
        : newSessionLaunchError;
  const projectCreateError = projectCreateRequest?.result?.status === "rejected" || projectCreateRequest?.result?.status === "retryable"
    ? projectCreateRequest.result.error.message
    : newSessionLaunchError;

  useEffect(() => () => returnFocusRef.current?.focus(), []);
  useEffect(() => {
    if (flow.kind !== "new-directory") return;
    const focusTimer = window.setTimeout(() => (inputRef.current ?? panelRef.current)?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [directoryRequest, flow.kind]);
  useEffect(() => {
    if (createRequest?.result?.status !== "succeeded") return;
    props.onSessionStarted?.(createRequest.result.sessionKey);
    props.onClose();
  }, [createRequest?.result, props.onClose, props.onSessionStarted]);
  useEffect(() => {
    if (projectCreateRequest?.result?.status !== "succeeded") return;
    props.onProjectCreated?.(projectCreateRequest.result.project.projectId);
    props.onClose();
  }, [projectCreateRequest?.result, props.onClose, props.onProjectCreated]);
  useLayoutEffect(() => {
    setActiveIndex(0);
    (inputRef.current ?? panelRef.current)?.focus();
  }, [flow.kind]);
  useEffect(() => {
    const focusTimer = window.setTimeout(() => (inputRef.current ?? panelRef.current)?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [flow.kind]);
  useLayoutEffect(() => {
    const activeOption = panelRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, flow.kind, query]);
  const back = (): void => {
    if (props.pending || starting || savingProject) return;
    if (flow.kind === "actions") props.onClose();
    else if (flow.kind === "new-name") setFlow(flow.back === "new-directory" ? { kind: "new-directory", purpose: "session" } : { kind: flow.back });
    else if (flow.kind === "add-project-name") setFlow({ kind: "new-directory", purpose: "project" });
    else if (flow.kind === "new-directory") { setFlow(flow.purpose === "project" ? { kind: "actions" } : { kind: "new-location" }); setQuery(""); }
    else if (flow.kind === "new-project") { setFlow({ kind: "new-location" }); setQuery(""); }
    else if (flow.kind === "sessions" && flow.projectId !== undefined) { setFlow({ kind: "projects" }); setQuery(""); }
    else { setFlow({ kind: "actions" }); setQuery(""); }
  };
  const select = (): void => {
    if (props.pending || starting || savingProject) return;
    if (flow.kind === "actions") shownActions[activeIndex]?.run();
    else if (flow.kind === "model") { const model = props.models?.[activeIndex]; if (model) props.onSetModel?.(model.provider, model.modelId); }
    else if (flow.kind === "thinking") { const level = props.thinkingLevels?.[activeIndex]; if (level) props.onSetThinking?.(level); }
    else if (flow.kind === "projects") { const project = shownPaletteProjects[activeIndex]; if (project?.available) { setFlow({ kind: "sessions", projectId: project.projectId, projectName: project.name, projectPath: project.displayPath }); setQuery(""); } }
    else if (flow.kind === "sessions") { const session = shownSessions[activeIndex]; if (session) closeAfter(() => props.onOpenSession?.(session.id)); }
    else if (flow.kind === "workspaces") { const workspace = shownWorkspaces[activeIndex]; if (workspace) closeAfter(() => props.onSelectWorkspace?.(workspace.id)); }
    else if (flow.kind === "stashes") { const stash = shownStashes[activeIndex]; if (stash) props.onRestoreStash?.(stash); }
    else if (flow.kind === "new-location") {
      const location = locationChoices[activeIndex];
      if (location === "directories") openDirectory();
      else if (location === "projects") { setQuery(""); setFlow({ kind: "new-project" }); }
    } else if (flow.kind === "new-project") {
      const project = shownProjects[activeIndex];
      if (project !== undefined) startNameFlow({ path: project.displayPath, displayPath: project.displayPath }, "new-project");
    } else if (flow.kind === "new-directory" && directory !== undefined) {
      if (activeIndex === 0) {
        const location = { path: directory.current.path, displayPath: directory.current.displayPath };
        if (flow.purpose === "project") { setProjectName(""); setProjectCreateRequestId(undefined); setNewSessionLaunchError(undefined); setFlow({ kind: "add-project-name", location }); }
        else startNameFlow(location, "new-directory");
      }
      else if (directory.parent !== undefined && activeIndex === 1) { setQuery(""); loadDirectory(directory.parent.path); }
      else {
        const directoryIndex = activeIndex - 1 - (directory.parent === undefined ? 0 : 1);
        const selectedDirectory = shownDirectories[directoryIndex];
        if (selectedDirectory !== undefined) { setQuery(""); loadDirectory(selectedDirectory.path); }
      }
    } else if (flow.kind === "close") {
      if (activeIndex === 0) back();
      else props.onConfirmClose?.();
    }
  };
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      back();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  });
  const handleKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); back(); return; }
    const listFlow = flow.kind === "actions" || flow.kind === "projects" || flow.kind === "model" || flow.kind === "thinking" || flow.kind === "close" || flow.kind === "new-location" || flow.kind === "new-project" || flow.kind === "new-directory" || flow.kind === "sessions" || flow.kind === "workspaces" || flow.kind === "stashes";
    if (listFlow && (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey))) { event.preventDefault(); if (count) setActiveIndex((i) => (i + 1) % count); return; }
    if (listFlow && (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey))) { event.preventDefault(); if (count) setActiveIndex((i) => (i - 1 + count) % count); return; }
    if (event.key === "Enter" && flow.kind !== "rename" && flow.kind !== "new-name" && flow.kind !== "add-project-name") { event.preventDefault(); select(); }
  };
  const closeSessionName = props.sessionName?.trim();
  const title = flow.kind === "actions" ? "Session actions" : flow.kind === "rename" ? "Rename Session" : flow.kind === "model" ? "Change model" : flow.kind === "thinking" ? "Change thinking level" : flow.kind === "projects" ? "Projects" : flow.kind === "sessions" ? (flow.projectName ?? "Sessions") : flow.kind === "workspaces" ? "Workspaces" : flow.kind === "stashes" ? "Stashed messages" : flow.kind === "close" ? closeSessionName ? `Close ${closeSessionName}?` : "Close this Session?" : flow.kind === "new-location" ? "Choose location" : flow.kind === "new-project" ? "Choose project" : flow.kind === "new-directory" ? "Choose directory" : flow.kind === "add-project-name" ? "Name your Project" : "Name your Session";
  const flowGlyph = flow.kind === "rename" ? <Pencil aria-hidden="true" size={14} /> : flow.kind === "model" ? <Bot aria-hidden="true" size={14} /> : flow.kind === "thinking" ? <Brain aria-hidden="true" size={14} /> : flow.kind === "sessions" ? <History aria-hidden="true" size={14} /> : flow.kind === "workspaces" ? <PanelsTopLeft aria-hidden="true" size={14} /> : flow.kind === "stashes" ? <Archive aria-hidden="true" size={14} /> : flow.kind === "new-location" || flow.kind === "new-project" || flow.kind === "new-directory" ? <Folder aria-hidden="true" size={14} /> : flow.kind === "new-name" || flow.kind === "add-project-name" ? <Plus aria-hidden="true" size={14} /> : <X aria-hidden="true" size={14} />;
  const listFooter = flow.kind === "actions" || flow.kind === "projects" || flow.kind === "model" || flow.kind === "thinking" || flow.kind === "new-location" || flow.kind === "new-project" || flow.kind === "new-directory" || flow.kind === "sessions" || flow.kind === "workspaces" || flow.kind === "stashes";

  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) back(); }}>
    <section ref={panelRef} className="palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" tabIndex={-1} onKeyDown={handleKeyDown}>
      {(flow.kind === "actions" || flow.kind === "projects" || flow.kind === "sessions" || flow.kind === "workspaces") && <label className="palette-search"><Search aria-hidden="true" size={17} /><span id="palette-title" className="sr-only">{title}</span><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder={flow.kind === "sessions" ? "Search Sessions…" : flow.kind === "projects" ? "Search Projects…" : flow.kind === "workspaces" ? "Search Workspaces…" : "Choose an action…"} aria-label={flow.kind === "workspaces" ? "Search Workspaces" : undefined} aria-controls="palette-results" /><kbd>Esc</kbd></label>}
      {flow.kind !== "actions" && flow.kind !== "projects" && flow.kind !== "sessions" && flow.kind !== "workspaces" && <header className="palette-flow-header"><button type="button" onClick={back} disabled={props.pending || starting || savingProject} aria-label="Back">{flowGlyph}</button><h2 id="palette-title">{title}</h2><kbd>Esc</kbd></header>}
      {(flow.kind === "new-project" || flow.kind === "new-directory") && <div className="palette-search palette-subsearch"><Search aria-hidden="true" size={17} /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder={flow.kind === "new-project" ? "Filter projects…" : "Filter directories…"} aria-label={flow.kind === "new-project" ? "Filter projects" : "Filter directories"} aria-controls="palette-results" />{flow.kind === "new-directory" && <button type="button" className={showHidden ? "active" : ""} aria-pressed={showHidden} disabled={directoryRequest?.status === "loading"} onClick={() => { const hidden = !showHidden; setShowHidden(hidden); loadDirectory(directory?.current.path, hidden); }}>Hidden</button>}</div>}
      {flow.kind === "rename" && <form className="palette-form" onSubmit={(event) => { event.preventDefault(); const value = flow.value.trim(); if (value && !props.pending) props.onRename?.(value); }}><label>Session name<input ref={inputRef} value={flow.value} maxLength={120} onChange={(event) => setFlow({ kind: "rename", value: event.target.value })} /></label><button type="submit" disabled={!flow.value.trim() || props.pending}>{props.pending ? "Saving…" : "Save"}</button></form>}
      {(flow.kind === "actions" || flow.kind === "model" || flow.kind === "thinking") && <div id="palette-results" className="palette-results" role="listbox">
        {(flow.kind === "actions" ? shownActions : choices).map((item, index) => {
          const name = typeof item === "string" ? titleCase(item) : "name" in item ? item.name : `${item.displayName ?? item.modelId} · ${item.provider}`;
          const selected = flow.kind === "model" && typeof item !== "string" && "modelId" in item ? item.provider === props.currentModel?.provider && item.modelId === props.currentModel.modelId : flow.kind === "thinking" ? item === props.currentThinking : false;
          const runItem = (): void => { setActiveIndex(index); if (flow.kind === "actions") (item as PaletteAction).run(); else if (flow.kind === "model" && typeof item !== "string") props.onSetModel?.((item as ModelChoice).provider, (item as ModelChoice).modelId); else if (flow.kind === "thinking" && typeof item === "string") props.onSetThinking?.(item); };
          const glyph = flow.kind === "actions" ? (item as PaletteAction).glyph : selected ? "✓" : "";
          return <button type="button" key={typeof item === "string" ? item : "name" in item ? item.name : `${item.provider}:${item.modelId}`} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={runItem} disabled={props.pending}><span className="palette-option-glyph" aria-hidden="true">{glyph}</span><span className="palette-option-name">{name}</span></button>;
        })}
        {count === 0 && <p className="palette-empty" role="status">No actions match that search.</p>}
      </div>}
      {flow.kind === "projects" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Projects">
        {shownPaletteProjects.map((project, index) => <button type="button" key={project.projectId} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} disabled={!project.available} onClick={() => { if (project.available) { setFlow({ kind: "sessions", projectId: project.projectId, projectName: project.name, projectPath: project.displayPath }); setQuery(""); } }}><span className="palette-option-glyph" aria-hidden="true"><FolderKanban size={14} /></span><span className="palette-option-copy"><span className="palette-option-name">{project.name}</span><small>{project.displayPath}{project.available ? "" : " · Unavailable"}</small></span></button>)}
        {shownPaletteProjects.length === 0 && <p className="palette-empty" role="status">No Projects match that search.</p>}
      </div>}
      {flow.kind === "sessions" && flow.projectId !== undefined && <div className="palette-flow-header"><button type="button" onClick={back} aria-label="Back"><ArrowLeft aria-hidden="true" size={14} /></button><h2>{flow.projectName}</h2><small>{flow.projectPath}</small></div>}
      {flow.kind === "sessions" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Sessions">
        {shownSessions.map((session, index) => <button type="button" key={session.id} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={() => closeAfter(() => props.onOpenSession?.(session.id))}>
          <span className="palette-option-glyph" aria-hidden="true"><History size={14} /></span>
          <span className="palette-option-copy"><span className="palette-option-name">{session.name}</span><small>{[flow.projectId === undefined ? session.projectName : undefined, session.bookmarked ? "Bookmarked" : undefined, session.closed ? "Closed" : undefined].filter(Boolean).join(" · ")}</small></span>
        </button>)}
        {count === 0 && <p className="palette-empty" role="status">No named Sessions match that search.</p>}
      </div>}
      {flow.kind === "workspaces" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Workspaces">
        {shownWorkspaces.map((workspace, index) => <button type="button" key={workspace.id} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={() => closeAfter(() => props.onSelectWorkspace?.(workspace.id))} disabled={props.pending}>
          <span className="palette-option-glyph" aria-hidden="true">{workspace.id === props.activeWorkspaceId ? "✓" : <PanelsTopLeft size={14} />}</span>
          <span className="palette-option-name">{workspace.name}</span>
        </button>)}
        {shownWorkspaces.length === 0 && <p className="palette-empty" role="status">No Workspaces match that search.</p>}
      </div>}
      {flow.kind === "stashes" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Stashed messages">
        {shownStashes.map((stash, index) => <button type="button" key={stash.id} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={() => props.onRestoreStash?.(stash)} disabled={props.pending}>
          <span className="palette-option-glyph" aria-hidden="true"><Archive size={14} /></span><span className="palette-option-copy"><span className="palette-option-name">{stash.text.trim().slice(0, 80) || `${stash.images.length + stash.attachments.length} attachment${stash.images.length + stash.attachments.length === 1 ? "" : "s"}`}</span><small>{new Date(stash.createdAt).toLocaleString()}</small></span>
        </button>)}
        {count === 0 && <p className="palette-empty palette-empty-option" role="status"><span className="palette-option-glyph" aria-hidden="true"><Archive size={14} /></span><span className="palette-option-copy"><span className="palette-option-name">No stashed messages.</span></span></p>}
      </div>}
      {flow.kind === "new-location" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Session locations">
        <button type="button" role="option" aria-selected={activeIndex === 0} className={activeIndex === 0 ? "active" : ""} onClick={() => { setQuery(""); setFlow({ kind: "new-project" }); }}><span className="palette-option-glyph" aria-hidden="true"><FolderKanban size={14} /></span><span className="palette-option-copy"><span className="palette-option-name">Projects</span><small>Choose from available projects</small></span></button>
        <button type="button" role="option" aria-selected={activeIndex === 1} className={activeIndex === 1 ? "active" : ""} onClick={() => openDirectory("session")}><span className="palette-option-glyph" aria-hidden="true"><Folder size={14} /></span><span className="palette-option-copy"><span className="palette-option-name">Directories</span><small>Browse from the current directory</small></span></button>
      </div>}
      {flow.kind === "new-project" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Projects">
        {shownProjects.map((project, index) => <button type="button" key={project.projectId} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={() => startNameFlow({ path: project.displayPath, displayPath: project.displayPath }, "new-project")}><span className="palette-option-glyph" aria-hidden="true"><FolderKanban size={14} /></span><span className="palette-option-copy"><span className="palette-option-name">{project.name}</span><small>{project.displayPath}</small></span></button>)}
        {shownProjects.length === 0 && <p className="palette-empty" role="status">No available projects match that search.</p>}
      </div>}
      {flow.kind === "new-directory" && <div className="palette-directory">
        <div className="palette-directory-current"><small>Current</small><strong>{directory?.current.displayPath ?? "Loading…"}</strong></div>
        <div id="palette-results" className="palette-results palette-directory-list" role="listbox" aria-label="Directories">
          {directory !== undefined && <button type="button" role="option" aria-selected={activeIndex === 0} className={`palette-directory-use${activeIndex === 0 ? " active" : ""}`} onClick={() => { setActiveIndex(0); select(); }}><Plus aria-hidden="true" size={14} /><span><strong>Use current directory</strong><small>{directory.current.displayPath}</small></span></button>}
          {directory?.parent && <DirectoryButton index={1} activeIndex={activeIndex} name="Parent directory" path={directory.parent.displayPath} onClick={() => { setQuery(""); loadDirectory(directory.parent?.path); }} />}
          {shownDirectories.map((item, index) => { const choiceIndex = index + 1 + (directory?.parent === undefined ? 0 : 1); return <DirectoryButton key={item.path} index={choiceIndex} activeIndex={activeIndex} name={item.name} path={item.displayPath} onClick={() => { setQuery(""); loadDirectory(item.path); }} />; })}
          {directory !== undefined && directoryChoiceCount === 1 + (directory.parent === undefined ? 0 : 1) && query.trim() && <p className="palette-empty" role="status">No child directories match that search.</p>}
        </div>
        {directoryRequest?.status === "loading" && <p className="palette-state" role="status">Loading directories…</p>}
      </div>}
      {flow.kind === "new-name" && <form className="palette-form palette-new-session-form" onSubmit={(event) => { event.preventDefault(); if (starting) return; setNewSessionLaunchError(undefined); const trimmed = newSessionName.trim(); const id = props.onCreateSession?.(flow.location.path, trimmed === "" ? undefined : trimmed); if (id === undefined) setNewSessionLaunchError("Pi Station could not start the Session."); else setCreateRequestId(id); }}><p className="palette-location"><small>Location</small><strong>{flow.location.displayPath}</strong></p><label>Session name <span>(optional)</span><input ref={inputRef} value={newSessionName} maxLength={120} autoComplete="off" placeholder="e.g. Release planning" disabled={starting} onChange={(event) => setNewSessionName(event.target.value)} /></label><button type="submit" disabled={starting}>{starting ? "Starting…" : "Start Pi"}</button></form>}
      {flow.kind === "add-project-name" && <form className="palette-form" onSubmit={(event) => { event.preventDefault(); if (savingProject) return; const trimmed = projectName.trim(); if (!trimmed) return; setNewSessionLaunchError(undefined); const id = props.onCreateProject?.(trimmed, flow.location.path); if (id === undefined) setNewSessionLaunchError("Pi Station could not create the Project."); else setProjectCreateRequestId(id); }}><p className="palette-location"><small>Location</small><strong>{flow.location.displayPath}</strong></p><label>Project name<input ref={inputRef} value={projectName} maxLength={120} autoComplete="off" placeholder="e.g. Pi Station" disabled={savingProject} required onChange={(event) => setProjectName(event.target.value)} /></label><button type="submit" disabled={!projectName.trim() || savingProject}>{savingProject ? "Saving…" : "Save Project"}</button></form>}
      {flow.kind === "close" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Close Session confirmation">{closeChoices.map((item, index) => <button type="button" key={item.name} role="option" aria-selected={index === activeIndex} className={`${index === activeIndex ? "active " : ""}${item.danger ? "danger" : ""}`.trim()} onClick={() => { setActiveIndex(index); if (index === 0) back(); else props.onConfirmClose?.(); }} disabled={props.pending}><span className="palette-option-glyph" aria-hidden="true">{item.glyph}</span><span className="palette-option-name">{item.danger && props.pending ? "Closing…" : item.name}</span></button>)}</div>}
      {(flow.kind === "new-directory" || flow.kind === "new-name") && newSessionError && <p className="palette-error" role="alert">{newSessionError}</p>}
      {flow.kind === "add-project-name" && projectCreateError && <p className="palette-error" role="alert">{projectCreateError}</p>}
      {flow.kind !== "new-directory" && flow.kind !== "new-name" && flow.kind !== "add-project-name" && props.error && <p className="palette-error" role="alert">{props.error}</p>}
      <footer>{listFooter ? "↑↓/Tab navigate · Enter select" : "Escape goes back"}</footer>
    </section>
  </div>;
}

function DirectoryButton({ index, activeIndex, name, path, onClick }: { index: number; activeIndex: number; name: string; path: string; onClick: () => void }) { return <button type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={onClick}><Folder aria-hidden="true" size={14} /><span><strong>{name}</strong><small>{path}</small></span></button>; }
function sessionPaletteRank(session: PaletteSession): number { return session.bookmarked ? 0 : session.closed ? 2 : 1; }
function titleCase(value: string): string { return value.length ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value; }
