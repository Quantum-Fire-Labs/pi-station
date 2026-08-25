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
  FolderKanban,
  FolderPlus,
  History,
  Hash,
  Info,
  LayoutDashboard,
  Pencil,
  Plus,
  Search,
  Square,
  X,
} from "lucide-react";
import type { ModelChoice, ThinkingLevel } from "../application/workspace-model";

interface PaletteAction {
  glyph: ReactNode;
  name: string;
  run: () => void;
}

export interface PaletteSession {
  readonly id: string;
  readonly name: string;
  readonly projectName?: string | undefined;
  readonly closed: boolean;
}

type Flow =
  | { kind: "actions" }
  | { kind: "rename"; value: string }
  | { kind: "model" }
  | { kind: "thinking" }
  | { kind: "sessions" }
  | { kind: "close" };

export interface CommandPaletteProps {
  onClose: () => void;
  sessionName?: string | undefined;
  sessionId?: string | undefined;
  projectName?: string | undefined;
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
  pending?: boolean | undefined;
  error?: string | undefined;
  onDashboard: () => void;
  onProjects: () => void;
  onAddProject: () => void;
  onNewSession?: (() => void) | undefined;
  onOpenProject?: (() => void) | undefined;
  onNewProjectSession?: (() => void) | undefined;
  onSessionDetails?: (() => void) | undefined;
  onRename?: ((name: string) => void) | undefined;
  onSetModel?: ((provider: string, modelId: string) => void) | undefined;
  onSetThinking?: ((level: ThinkingLevel) => void) | undefined;
  onOpenSession?: ((id: string) => void) | undefined;
  onSetBookmark?: ((bookmarked: boolean) => void) | undefined;
  onClone?: (() => void) | undefined;
  onAbort?: (() => void) | undefined;
  onConfirmClose?: (() => void) | undefined;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [flow, setFlow] = useState<Flow>({ kind: "actions" });
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const closeAfter = (action: (() => void) | undefined): void => {
    action?.();
    props.onClose();
  };
  const actions = useMemo<readonly PaletteAction[]>(() => {
    const items: PaletteAction[] = [
      { glyph: <LayoutDashboard aria-hidden="true" size={16} />, name: "Dashboard", run: () => closeAfter(props.onDashboard) },
      { glyph: <FolderKanban aria-hidden="true" size={16} />, name: "Projects", run: () => closeAfter(props.onProjects) },
      { glyph: <FolderPlus aria-hidden="true" size={16} />, name: "Add Project", run: () => closeAfter(props.onAddProject) },
    ];
    if (props.onOpenSession) items.push({ glyph: <History aria-hidden="true" size={16} />, name: "Sessions", run: () => { setFlow({ kind: "sessions" }); setQuery(""); } });
    if (props.canCreateSession && props.onNewSession) items.push({ glyph: <Plus aria-hidden="true" size={16} />, name: "New Session", run: () => closeAfter(props.onNewSession) });
    if (props.projectName && props.onOpenProject) items.push({ glyph: <FolderKanban aria-hidden="true" size={16} />, name: `Open Project: ${props.projectName}`, run: () => closeAfter(props.onOpenProject) });
    if (props.projectName && props.canCreateSession && props.onNewProjectSession) items.push({ glyph: <Plus aria-hidden="true" size={16} />, name: `New Session in ${props.projectName}`, run: () => closeAfter(props.onNewProjectSession) });
    if (props.onSessionDetails) items.push({ glyph: <Info aria-hidden="true" size={16} />, name: "Session details", run: () => closeAfter(props.onSessionDetails) });
    if (props.canClone && props.onClone) items.push({ glyph: <Copy aria-hidden="true" size={16} />, name: "Clone Session", run: () => closeAfter(props.onClone) });
    if (props.canRename && props.onRename) items.push({ glyph: <Pencil aria-hidden="true" size={16} />, name: "Rename Session", run: () => setFlow({ kind: "rename", value: props.sessionName ?? "" }) });
    if (props.canChangeModel && props.models?.length && props.onSetModel) items.push({ glyph: <Bot aria-hidden="true" size={16} />, name: "Change model", run: () => setFlow({ kind: "model" }) });
    if (props.canChangeThinking && props.thinkingLevels?.length && props.onSetThinking) items.push({ glyph: <Brain aria-hidden="true" size={16} />, name: "Change thinking level", run: () => setFlow({ kind: "thinking" }) });
    if (props.sessionId) items.push({ glyph: <Hash aria-hidden="true" size={16} />, name: "Copy Session ID", run: () => {
      void navigator.clipboard?.writeText(props.sessionId!).then(props.onClose).catch(() => undefined);
    } });
    if (props.projectName && props.onSetBookmark) items.push({ glyph: <Bookmark aria-hidden="true" size={16} />, name: props.bookmarked ? "Remove Session Bookmark" : "Bookmark Session", run: () => closeAfter(() => props.onSetBookmark?.(!props.bookmarked)) });
    if (props.working && props.canAbort && props.onAbort) items.push({ glyph: <Square aria-hidden="true" size={15} />, name: "Abort", run: () => closeAfter(props.onAbort) });
    if (props.canClose && props.onConfirmClose) items.push({ glyph: <X aria-hidden="true" size={16} />, name: "Close Session", run: () => setFlow({ kind: "close" }) });
    return items;
  }, [props]);
  const shownActions = useMemo(() => actions.filter(({ name }) => name.toLowerCase().includes(query.toLowerCase())), [actions, query]);
  const choices = flow.kind === "model" ? props.models ?? [] : flow.kind === "thinking" ? props.thinkingLevels ?? [] : [];
  const shownSessions = useMemo(() => {
    if (flow.kind !== "sessions") return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...(props.sessions ?? [])]
      .filter((session) => session.name.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => Number(left.closed) - Number(right.closed)
        || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
        || (left.projectName ?? "").localeCompare(right.projectName ?? "", undefined, { sensitivity: "base" }));
  }, [flow.kind, props.sessions, query]);
  const closeChoices = [
    { glyph: <ArrowLeft aria-hidden="true" size={16} />, name: "Keep Session open", danger: false },
    { glyph: <X aria-hidden="true" size={16} />, name: props.working ? "Stop work and close Session" : "Close Session", danger: true },
  ] as const;
  const count = flow.kind === "actions" ? shownActions.length : flow.kind === "sessions" ? shownSessions.length : flow.kind === "close" ? closeChoices.length : choices.length;

  useEffect(() => () => returnFocusRef.current?.focus(), []);
  useLayoutEffect(() => {
    setActiveIndex(0);
    (inputRef.current ?? panelRef.current)?.focus();
  }, [flow.kind]);
  useLayoutEffect(() => {
    const activeOption = panelRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    activeOption?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, flow.kind, query]);
  const back = (): void => {
    if (props.pending) return;
    if (flow.kind === "actions") props.onClose();
    else { setFlow({ kind: "actions" }); setQuery(""); }
  };
  const select = (): void => {
    if (props.pending) return;
    if (flow.kind === "actions") shownActions[activeIndex]?.run();
    else if (flow.kind === "model") { const model = props.models?.[activeIndex]; if (model) props.onSetModel?.(model.provider, model.modelId); }
    else if (flow.kind === "thinking") { const level = props.thinkingLevels?.[activeIndex]; if (level) props.onSetThinking?.(level); }
    else if (flow.kind === "sessions") { const session = shownSessions[activeIndex]; if (session) closeAfter(() => props.onOpenSession?.(session.id)); }
    else if (flow.kind === "close") {
      if (activeIndex === 0) back();
      else props.onConfirmClose?.();
    }
  };
  const handleKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); back(); return; }
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) { event.preventDefault(); if (count) setActiveIndex((i) => (i + 1) % count); return; }
    if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) { event.preventDefault(); if (count) setActiveIndex((i) => (i - 1 + count) % count); return; }
    if (event.key === "Enter" && flow.kind !== "rename") { event.preventDefault(); select(); }
  };
  const closeSessionName = props.sessionName?.trim();
  const title = flow.kind === "actions" ? "Session actions" : flow.kind === "rename" ? "Rename Session" : flow.kind === "model" ? "Change model" : flow.kind === "thinking" ? "Change thinking level" : flow.kind === "sessions" ? "Sessions" : closeSessionName ? `Close ${closeSessionName}?` : "Close this Session?";
  const flowGlyph = flow.kind === "rename" ? <Pencil aria-hidden="true" size={14} /> : flow.kind === "model" ? <Bot aria-hidden="true" size={14} /> : flow.kind === "thinking" ? <Brain aria-hidden="true" size={14} /> : flow.kind === "sessions" ? <History aria-hidden="true" size={14} /> : <X aria-hidden="true" size={14} />;

  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) back(); }}>
    <section ref={panelRef} className="palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" tabIndex={-1} onKeyDown={handleKeyDown}>
      {(flow.kind === "actions" || flow.kind === "sessions") && <label className="palette-search"><Search aria-hidden="true" size={17} /><span id="palette-title" className="sr-only">{title}</span><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} placeholder={flow.kind === "sessions" ? "Search Sessions…" : "Choose an action…"} aria-controls="palette-results" /><kbd>Esc</kbd></label>}
      {flow.kind !== "actions" && flow.kind !== "sessions" && <header className="palette-flow-header"><button type="button" onClick={back} disabled={props.pending} aria-label="Back to actions">{flowGlyph}</button><h2 id="palette-title">{title}</h2><kbd>Esc</kbd></header>}
      {flow.kind === "rename" && <form className="palette-form" onSubmit={(event) => { event.preventDefault(); const value = flow.value.trim(); if (value && !props.pending) props.onRename?.(value); }}><label>Session name<input ref={inputRef} value={flow.value} maxLength={120} onChange={(event) => setFlow({ kind: "rename", value: event.target.value })} /></label><button type="submit" disabled={!flow.value.trim() || props.pending}>{props.pending ? "Saving…" : "Save"}</button></form>}
      {(flow.kind === "actions" || flow.kind === "model" || flow.kind === "thinking") && <div id="palette-results" className="palette-results" role="listbox">
        {(flow.kind === "actions" ? shownActions : choices).map((item, index) => {
          const name = typeof item === "string" ? titleCase(item) : "name" in item ? item.name : `${item.displayName ?? item.modelId} · ${item.provider}`;
          const selected = flow.kind === "model" && typeof item !== "string" && "modelId" in item ? item.provider === props.currentModel?.provider && item.modelId === props.currentModel.modelId : flow.kind === "thinking" ? item === props.currentThinking : false;
          const runItem = (): void => {
            setActiveIndex(index);
            if (flow.kind === "actions") {
              (item as PaletteAction).run();
            } else if (flow.kind === "model" && typeof item !== "string") {
              const model = item as ModelChoice;
              props.onSetModel?.(model.provider, model.modelId);
            } else if (flow.kind === "thinking" && typeof item === "string") {
              props.onSetThinking?.(item);
            }
          };
          const glyph = flow.kind === "actions" ? (item as PaletteAction).glyph : selected ? "✓" : "";
          return <button type="button" key={typeof item === "string" ? item : "name" in item ? item.name : `${item.provider}:${item.modelId}`} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={runItem} disabled={props.pending}><span className="palette-option-glyph" aria-hidden="true">{glyph}</span><span className="palette-option-name">{name}</span></button>;
        })}
        {count === 0 && <p className="palette-empty" role="status">No actions match that search.</p>}
      </div>}
      {flow.kind === "sessions" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Sessions">
        {shownSessions.map((session, index) => <button type="button" key={session.id} role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} onClick={() => closeAfter(() => props.onOpenSession?.(session.id))}>
          <span className="palette-option-glyph" aria-hidden="true"><History size={14} /></span>
          <span className="palette-option-copy"><span className="palette-option-name">{session.name}</span><small>{[session.projectName, session.closed ? "Closed" : undefined].filter(Boolean).join(" · ")}</small></span>
        </button>)}
        {count === 0 && <p className="palette-empty" role="status">No named Sessions match that search.</p>}
      </div>}
      {flow.kind === "close" && <div id="palette-results" className="palette-results" role="listbox" aria-label="Close Session confirmation">
        {closeChoices.map((item, index) => <button
          type="button"
          key={item.name}
          role="option"
          aria-selected={index === activeIndex}
          className={`${index === activeIndex ? "active " : ""}${item.danger ? "danger" : ""}`.trim()}
          onClick={() => {
            setActiveIndex(index);
            if (index === 0) back();
            else props.onConfirmClose?.();
          }}
          disabled={props.pending}
        ><span className="palette-option-glyph" aria-hidden="true">{item.glyph}</span><span className="palette-option-name">{item.danger && props.pending ? "Closing…" : item.name}</span></button>)}
      </div>}
      {props.error && <p className="palette-error" role="alert">{props.error}</p>}
      <footer>{flow.kind === "actions" || flow.kind === "model" || flow.kind === "thinking" || flow.kind === "sessions" ? "↑↓/Tab navigate · Enter select" : "Escape goes back"}</footer>
    </section>
  </div>;
}

function titleCase(value: string): string { return value.length ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value; }
