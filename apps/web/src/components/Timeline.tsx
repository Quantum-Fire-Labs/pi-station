import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import { Undo2 } from "lucide-react";
import remarkGfm from "remark-gfm";
import type { TimelineItem } from "../application/workspace-model";

function isSharedMarkdownUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    if (parsed.pathname.startsWith("/shared/")) return /\.(?:md|markdown)$/iu.test(parsed.pathname);
    const projectPath = parsed.searchParams.get("path");
    return /^\/project-files\/[^/]+\/[^/]+$/u.test(parsed.pathname)
      && projectPath !== null
      && /\.(?:md|markdown)$/iu.test(projectPath);
  } catch {
    return false;
  }
}

function ExternalLink({
  children,
  onOpenSharedMarkdown,
  ...properties
}: ComponentPropsWithoutRef<"a"> & { onOpenSharedMarkdown?: ((url: string) => void) | undefined }) {
  const href = typeof properties.href === "string" ? properties.href : undefined;
  const sharedMarkdown = href !== undefined && isSharedMarkdownUrl(href);
  return (
    <a
      {...properties}
      target="_blank"
      rel="noopener noreferrer"
      onClick={sharedMarkdown && onOpenSharedMarkdown !== undefined ? (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenSharedMarkdown(href);
      } : properties.onClick}
    >
      {children}
    </a>
  );
}

function ImagePlaceholder({ alt }: ComponentPropsWithoutRef<"img">) {
  return (
    <span className="markdown-image-placeholder">
      [Image: {alt?.trim() || "image"}]
    </span>
  );
}

type UserMessageItem = Extract<TimelineItem, { category: "user-message" }>;
type MessageImage =
  | { readonly mediaType: "image/png" | "image/jpeg" | "image/webp"; readonly data: string }
  | { readonly mediaType: "image/png" | "image/jpeg" | "image/webp"; readonly historyImageId: string }
  | { readonly unavailable: true };

function imageSource(item: UserMessageItem, image: MessageImage): string | undefined {
  if ("unavailable" in image) return undefined;
  if ("data" in image) return `data:${image.mediaType};base64,${image.data}`;
  const projectId = encodeURIComponent(item.sessionKey.hostId);
  const sessionId = encodeURIComponent(item.sessionKey.piSessionId);
  const imageId = encodeURIComponent(image.historyImageId);
  return `/v2/projects/${projectId}/sessions/${sessionId}/images/${imageId}`;
}

function MessageImagePreview({ item, image, index }: { item: UserMessageItem; image: MessageImage; index: number }) {
  const source = imageSource(item, image);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  if (source === undefined || failed) {
    return (
      <span className="message-image-placeholder" role="img" aria-label={`Attached image ${index + 1} is unavailable`}>
        Image unavailable
      </span>
    );
  }

  return (
    <a
      className="message-image-link"
      href={source}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open attached image ${index + 1}`}
    >
      <img
        src={source}
        alt={`Attached image ${index + 1}`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </a>
  );
}

function Markdown({ text, onOpenSharedMarkdown }: { text: string; onOpenSharedMarkdown?: ((url: string) => void) | undefined }) {
  return (
    <div className="message-body markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (properties) => <ExternalLink {...properties} onOpenSharedMarkdown={onOpenSharedMarkdown} />,
          img: ImagePlaceholder,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function StreamingMarkdown({
  text,
  onOpenSharedMarkdown,
}: {
  text: string;
  onOpenSharedMarkdown?: ((url: string) => void) | undefined;
}) {
  const latestText = useRef(text);
  const lastRender = useRef(performance.now());
  const [renderedText, setRenderedText] = useState(text);

  useEffect(() => {
    latestText.current = text;
    const elapsed = performance.now() - lastRender.current;
    const timeout = window.setTimeout(() => {
      lastRender.current = performance.now();
      setRenderedText(latestText.current);
    }, Math.max(0, 500 - elapsed));
    return () => window.clearTimeout(timeout);
  }, [text]);

  return (
    <div className="message-body markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (properties) => <ExternalLink {...properties} onOpenSharedMarkdown={onOpenSharedMarkdown} />,
          img: ImagePlaceholder,
        }}
      >
        {renderedText}
      </ReactMarkdown>
    </div>
  );
}

function MessageContent({
  text,
  state,
  onOpenSharedMarkdown,
}: {
  text: string;
  state: "streaming" | "complete" | "interrupted" | "error";
  onOpenSharedMarkdown?: ((url: string) => void) | undefined;
}) {
  if (state !== "streaming") return <Markdown text={text} onOpenSharedMarkdown={onOpenSharedMarkdown} />;
  return <StreamingMarkdown text={text} onOpenSharedMarkdown={onOpenSharedMarkdown} />;
}

function formatFileSize(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }

export function isThinkingPlaceholder(text: string): boolean {
  return /^thinking(?:\.{3}|…)?$/iu.test(text.trim());
}

function ToolActivity({
  item,
  sessionWorking,
}: {
  item: Extract<TimelineItem, { category: "tool-activity" }>;
  sessionWorking: boolean;
}) {
  const liveDuringTurn = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionWorking && item.source === "live") {
      liveDuringTurn.current = true;
      setOpen(true);
      return;
    }
    if (!sessionWorking && liveDuringTurn.current) {
      liveDuringTurn.current = false;
      setOpen(false);
    }
  }, [item.source, sessionWorking]);

  return (
    <article className="message tool">
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span>
            {item.content.state === "running" ? "Calling" : "Used"}{" "}
            {item.content.name}
          </span>
          <small>{item.content.summary}</small>
        </summary>
        <pre>
          {item.content.outputText ?? item.content.inputText ?? "No output"}
        </pre>
      </details>
    </article>
  );
}

function ContextSummary({
  item,
  onOpenSharedMarkdown,
}: {
  item: Extract<TimelineItem, { category: "context-summary" }>;
  onOpenSharedMarkdown?: ((url: string) => void) | undefined;
}) {
  const label = item.content.summaryType === "compaction" ? "Compaction summary" : "Branch summary";
  return (
    <article className="message context-summary">
      <details>
        <summary>
          <span>{label}</span>
          <small>Context preserved by Pi</small>
        </summary>
        <Markdown text={item.content.text} onOpenSharedMarkdown={onOpenSharedMarkdown} />
      </details>
    </article>
  );
}

export function FeedItem({
  item,
  sessionWorking = false,
  onOpenSharedMarkdown,
  onUndoUserMessage,
}: {
  item: TimelineItem;
  sessionWorking?: boolean;
  onOpenSharedMarkdown?: ((url: string) => void) | undefined;
  onUndoUserMessage?: (() => void) | undefined;
}) {
  switch (item.category) {
    case "user-message": {
      const attachments = (item.content as typeof item.content & { attachments?: readonly { id: string; name: string; mediaType: string; size: number }[] }).attachments;
      return (
        <article className="message user">
          {attachments !== undefined && attachments.length > 0 && (
            <div className="message-attachments">{attachments.map((file) => (
              <a key={file.id} className="message-attachment" href={`/v2/projects/${encodeURIComponent(item.sessionKey.hostId)}/sessions/${encodeURIComponent(item.sessionKey.piSessionId)}/attachments/${encodeURIComponent(file.id)}`} download={file.name}>
                {file.name} <small>{formatFileSize(file.size)}</small>
              </a>
            ))}</div>
          )}
          {item.content.images !== undefined && item.content.images.length > 0 && (
            <div className="message-images">
              {item.content.images.map((image, index) => (
                <MessageImagePreview
                  key={`image-${index}`}
                  item={item}
                  image={image}
                  index={index}
                />
              ))}
            </div>
          )}
          {item.content.text !== "" && <div className="message-body">{item.content.text}</div>}
          {onUndoUserMessage !== undefined && (
            <button
              className="message-undo"
              type="button"
              aria-label="Undo this message"
              title="Undo this message and later turns"
              onClick={() => {
                if (window.confirm("Undo this message? This will remove it and all later turns from the active conversation.")) onUndoUserMessage();
              }}
            >
              <Undo2 aria-hidden="true" size={14} />
            </button>
          )}
        </article>
      );
    }
    case "scheduled-job":
      return (
        <article className="message scheduled-job" data-job-id={item.content.jobId}>
          <strong>Scheduled Job · {item.content.title}</strong>
          <div className="message-body">{item.content.prompt}</div>
        </article>
      );
    case "thinking":
      if (item.content.state === "streaming" && isThinkingPlaceholder(item.content.text)) return null;
      return (
        <article className="message thinking">
          <MessageContent
            text={item.content.text}
            state={item.content.state}
            onOpenSharedMarkdown={onOpenSharedMarkdown}
          />
        </article>
      );
    case "tool-activity":
      return <ToolActivity item={item} sessionWorking={sessionWorking} />;
    case "context-summary":
      return <ContextSummary item={item} onOpenSharedMarkdown={onOpenSharedMarkdown} />;
    case "assistant-response":
      return (
        <article className="message assistant">
          <MessageContent text={item.content.text} state={item.content.state} onOpenSharedMarkdown={onOpenSharedMarkdown} />
        </article>
      );
    case "agent-message":
      return <ToolActivity item={{
        ...item,
        category: "tool-activity",
        content: {
          toolCallId: item.timelineItemId,
          name: "agent_message",
          summary: `From ${item.content.from ?? "Agent"}`,
          inputText: item.content.text,
          state: "succeeded",
          truncated: false,
        },
      }} sessionWorking={sessionWorking} />;
    case "extension-message":
      return (
        <article className="message custom">
          <strong>{item.content.sourceName}</strong>
          <div>{item.content.text}</div>
        </article>
      );
    case "notice":
      return (
        <article className="message notice" role="status">
          {item.content.text}
        </article>
      );
  }
}
