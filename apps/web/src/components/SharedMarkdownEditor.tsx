import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Circle, ExternalLink, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { readMarkdownVimMode } from "../editor-preferences";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";

export interface SharedMarkdownFile {
  readonly name: string;
  readonly url: string;
}

interface RemoteVersion {
  readonly content: string;
  readonly revision?: string;
}

const queryUrl = (url: string, parameter: string): string => `${url}${url.includes("?") ? "&" : "?"}${parameter}`;

export function SharedMarkdownEditor({ file, draftKey, onClose, onDirtyChange }: {
  file: SharedMarkdownFile;
  draftKey: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [revision, setRevision] = useState<string>();
  const [externalVersion, setExternalVersion] = useState<RemoteVersion>();
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "updated" | "error">("loading");
  const vimMode = readMarkdownVimMode();
  const load = useRef(0);
  const contentRef = useRef(content);
  const savedContentRef = useRef(savedContent);
  contentRef.current = content;
  savedContentRef.current = savedContent;
  const dirty = content !== savedContent;
  const displayStatus = externalVersion !== undefined
    ? "conflict"
    : status === "loading"
      ? "loading"
      : status === "saving"
        ? "saving"
        : status === "error"
          ? "error"
          : status === "updated"
            ? "updated"
            : dirty
              ? "unsaved"
              : "saved";
  const statusLabel = {
    loading: "Loading…",
    saving: "Saving…",
    error: "Save failed",
    conflict: "File changed externally",
    updated: "Updated by agent",
    unsaved: "Unsaved changes",
    saved: "Saved",
  }[displayStatus];

  const loadRemote = useCallback(async (initial: boolean): Promise<void> => {
    const request = ++load.current;
    try {
      const response = await fetch(queryUrl(file.url, "raw"), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("load failed");
      const text = await response.text();
      const nextRevision = response.headers.get("etag") ?? undefined;
      if (request !== load.current) return;
      if (initial) {
        let restored = text;
        try {
          const cached = JSON.parse(localStorage.getItem(draftKey) ?? "null") as unknown;
          if (typeof cached === "object" && cached !== null
            && "url" in cached && cached.url === file.url
            && "content" in cached && typeof cached.content === "string"
            && "savedContent" in cached && typeof cached.savedContent === "string"
            && cached.content !== cached.savedContent) restored = cached.content;
        } catch { /* Invalid local drafts do not block the shared file. */ }
        setContent(restored);
        setSavedContent(text);
        setRevision(nextRevision);
        setStatus("idle");
        return;
      }
      if (text === savedContentRef.current) { setRevision(nextRevision); return; }
      if (text === contentRef.current || contentRef.current === savedContentRef.current) {
        setContent(text);
        setSavedContent(text);
        setRevision(nextRevision);
        setExternalVersion(undefined);
        setStatus("updated");
        return;
      }
      setExternalVersion({ content: text, ...(nextRevision === undefined ? {} : { revision: nextRevision }) });
    } catch {
      if (initial && request === load.current) setStatus("error");
    }
  }, [draftKey, file.url]);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (status !== "updated") return;
    const timer = window.setTimeout(() => setStatus("saved"), 3_000);
    return () => window.clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    setStatus("loading");
    void loadRemote(true);
    return () => { load.current += 1; };
  }, [loadRemote]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const events = new EventSource(queryUrl(file.url, "watch"), { withCredentials: true });
    const changed = (): void => { void loadRemote(false); };
    events.addEventListener("change", changed);
    return () => { events.removeEventListener("change", changed); events.close(); };
  }, [file.url, loadRemote]);

  useEffect(() => {
    if (status === "loading") return;
    try {
      if (dirty) localStorage.setItem(draftKey, JSON.stringify({ url: file.url, content, savedContent }));
      else localStorage.removeItem(draftKey);
    } catch { /* Restricted storage keeps the draft in memory for this visit. */ }
  }, [content, dirty, draftKey, file.url, savedContent, status]);

  const save = async (): Promise<boolean> => {
    if (externalVersion !== undefined) return false;
    setStatus("saving");
    try {
      const response = await fetch(file.url, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "text/markdown", ...(revision === undefined ? {} : { "If-Match": revision }) },
        body: content,
      });
      if (response.status === 412) { setStatus("idle"); await loadRemote(false); return false; }
      if (!response.ok) throw new Error("save failed");
      setRevision(response.headers.get("etag") ?? undefined);
      setSavedContent(content);
      setStatus("saved");
      return true;
    } catch { setStatus("error"); return false; }
  };

  const loadAgentVersion = (): void => {
    if (externalVersion === undefined) return;
    setContent(externalVersion.content);
    setSavedContent(externalVersion.content);
    setRevision(externalVersion.revision);
    setExternalVersion(undefined);
    setStatus("updated");
  };
  const keepLocalVersion = (): void => {
    if (externalVersion === undefined) return;
    setSavedContent(externalVersion.content);
    setRevision(externalVersion.revision);
    setExternalVersion(undefined);
    setStatus("idle");
  };

  return (
    <aside className={`shared-markdown-editor${externalVersion === undefined ? "" : " has-external-change"}`} aria-label={`Edit ${file.name}`}>
      <header>
        <div>
          <strong>{file.name}</strong>
          <span className={`shared-markdown-status ${displayStatus}`} role="status">
            {(displayStatus === "saved" || displayStatus === "updated") && <Check aria-hidden="true" size={13} />}
            {(displayStatus === "unsaved" || displayStatus === "conflict") && <Circle aria-hidden="true" size={10} fill="currentColor" />}
            {(displayStatus === "loading" || displayStatus === "saving") && <LoaderCircle className="spin" aria-hidden="true" size={13} />}
            {displayStatus === "error" && <TriangleAlert aria-hidden="true" size={13} />}
            {statusLabel}
          </span>
        </div>
        <nav aria-label="Editor actions">
          <button className={dirty ? "primary" : undefined} type="button" onClick={() => void save()} disabled={status === "loading" || status === "saving" || !dirty || externalVersion !== undefined}>{status === "saving" ? "Saving…" : "Save"}</button>
          <a href={`/shared-editor?file=${encodeURIComponent(file.url)}`} target="_blank" rel="noopener noreferrer" aria-label="Open in new tab" title="Open in new tab"><ExternalLink aria-hidden="true" size={16} /></a>
          <button type="button" onClick={onClose} aria-label="Close editor"><X aria-hidden="true" size={17} /></button>
        </nav>
      </header>
      {externalVersion !== undefined && (
        <div className="shared-markdown-external-change" role="alert">
          <p>The agent changed this file while you had unsaved changes.</p>
          <div><button type="button" onClick={loadAgentVersion}>Load agent version</button><button type="button" onClick={keepLocalVersion}>Keep my version</button></div>
        </div>
      )}
      {status === "error" && content === "" ? <p role="alert">Pi Station could not load this file.</p> : (
        <MarkdownSourceEditor
          label={`Markdown content for ${file.name}`}
          value={content}
          disabled={status === "loading"}
          vimMode={vimMode}
          onSave={() => { if (dirty && status !== "saving") void save(); }}
          onClose={onClose}
          onSaveAndClose={() => {
            if (!dirty) { onClose(); return; }
            if (status !== "saving") void save().then((saved) => { if (saved) onClose(); });
          }}
          onChange={(value) => { setContent(value); if (status === "saved" || status === "updated" || status === "error") setStatus("idle"); }}
        />
      )}
    </aside>
  );
}
