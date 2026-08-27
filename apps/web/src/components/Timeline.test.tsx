// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineImage, TimelineItem } from "../application/workspace-model";
import { FeedItem } from "./Timeline";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const assistantItem = (text: string): TimelineItem => ({
  timelineItemId: "markdown-message",
  sessionKey: {
    hostId: "01900000-0000-7000-8000-000000000001",
    piSessionId: "session-markdown",
  },
  source: "saved",
  branchOrdinal: 0,
  category: "assistant-response",
  content: { text, state: "complete" },
});

const userImageItem = (images: TimelineImage[]): TimelineItem => ({
  timelineItemId: "user-image",
  sessionKey: {
    hostId: "project/id",
    piSessionId: "session id",
  },
  source: "saved",
  branchOrdinal: 0,
  category: "user-message",
  content: { text: "Inspect this image", images },
});

const toolItem = (source: "live" | "saved"): TimelineItem => ({
  timelineItemId: "tool-call",
  sessionKey: {
    hostId: "01900000-0000-7000-8000-000000000001",
    piSessionId: "session-markdown",
  },
  source,
  ...(source === "live" ? { liveSequence: 1 } : { branchOrdinal: 1 }),
  category: "tool-activity",
  content: {
    toolCallId: "call-1",
    name: "read",
    summary: "Read file",
    state: "succeeded",
    truncated: false,
  },
});

describe("Scheduled Job history", () => {
  it("renders one distinct auditable entry with its title and prompt", () => {
    const { container } = render(<FeedItem item={{
      ...assistantItem("unused"),
      timelineItemId: "scheduled-job-marker",
      category: "scheduled-job",
      content: { jobId: "job-1", title: "Daily review", prompt: "Review open work" },
    }} />);

    const entry = container.querySelector("article.scheduled-job");
    expect(entry).toHaveAttribute("data-job-id", "job-1");
    expect(entry).not.toHaveClass("user");
    expect(within(entry as HTMLElement).getByText("Scheduled Job · Daily review")).toBeVisible();
    expect(within(entry as HTMLElement).getByText("Review open work")).toBeVisible();
  });
});

describe("context summaries", () => {
  it("renders compaction context as a distinct collapsed, expandable card", () => {
    const { container } = render(<FeedItem item={{
      ...assistantItem("unused"),
      timelineItemId: "compaction",
      category: "context-summary",
      content: { summaryType: "compaction", text: "## Goal\nPreserve **important context**" },
    }} />);

    const entry = container.querySelector("article.message.context-summary");
    expect(entry).toBeInTheDocument();
    expect(entry?.querySelector("details")).not.toHaveAttribute("open");
    expect(within(entry as HTMLElement).getByText("Compaction summary")).toBeVisible();
    expect(within(entry as HTMLElement).getByText("Context preserved by Pi")).toBeVisible();

    fireEvent.click(within(entry as HTMLElement).getByText("Compaction summary"));
    expect(entry?.querySelector("details")).toHaveAttribute("open");
    expect(within(entry as HTMLElement).getByRole("heading", { name: "Goal" })).toBeVisible();
    expect(within(entry as HTMLElement).getByText("important context").tagName).toBe("STRONG");
  });
});

describe("tool activity", () => {
  it("opens live tools while Pi works and collapses them when Pi settles", () => {
    const { container, rerender } = render(
      <FeedItem item={toolItem("live")} sessionWorking />,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");

    rerender(<FeedItem item={toolItem("saved")} sessionWorking />);
    expect(container.querySelector("details")).toHaveAttribute("open");

    rerender(<FeedItem item={toolItem("saved")} sessionWorking={false} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("updates one rendered card across a tool lifecycle", () => {
    const running = { ...toolItem("live"), content: { ...toolItem("live").content, state: "running" } } as TimelineItem;
    const completed = { ...running, source: "saved", branchOrdinal: 1, content: { ...running.content, outputText: "Done", state: "succeeded" } } as TimelineItem;
    const { container, rerender } = render(<FeedItem item={running} sessionWorking />);
    expect(container.querySelectorAll("details")).toHaveLength(1);
    rerender(<FeedItem item={completed} sessionWorking={false} />);
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container).toHaveTextContent("Done");
  });

  it("shows the sent message when agent messaging tool activity is expanded", () => {
    const { container } = render(<FeedItem item={{
      ...toolItem("saved"),
      content: {
        ...toolItem("saved").content,
        name: "send_agent_message",
        inputText: JSON.stringify({ sessionId: "session-target", message: "Please review the updated layout." }),
        outputText: "Message started a turn for Session session-target",
      },
    } as TimelineItem} />);

    fireEvent.click(screen.getByText("Used send_agent_message"));
    expect(container).toHaveTextContent("Please review the updated layout.");
    expect(container).not.toHaveTextContent("Message started a turn for Session session-target");
  });

  it("renders inbound agent messages as received tool activity with the sender name", () => {
    const { container } = render(<FeedItem item={{
      ...assistantItem("unused"),
      timelineItemId: "agent-message",
      category: "agent-message",
      content: { from: "Themes", text: "Please review this." },
    }} />);

    expect(container.querySelector("article.message.tool")).toBeInTheDocument();
    expect(container).toHaveTextContent("Received agent message");
    expect(container).toHaveTextContent("Themes");
    expect(container).not.toHaveTextContent("Used agent_message");
    fireEvent.click(screen.getByText("Received agent message"));
    expect(container).toHaveTextContent("Please review this.");
  });

  it("keeps historical tools collapsed by default", () => {
    const { container } = render(
      <FeedItem item={toolItem("saved")} sessionWorking={false} />,
    );
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});

describe("user messages", () => {
  it("confirms before undoing the message and later turns", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onUndo = vi.fn();
    render(<FeedItem item={userImageItem([])} onUndoUserMessage={onUndo} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo this message" }));

    expect(confirm).toHaveBeenCalledWith("Undo this message? This will remove it and all later turns from the active conversation.");
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("keeps the conversation when undo confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onUndo = vi.fn();
    render(<FeedItem item={userImageItem([])} onUndoUserMessage={onUndo} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo this message" }));

    expect(onUndo).not.toHaveBeenCalled();
  });
});

describe("user image history", () => {
  it("renders text with a bounded safe Session image link", () => {
    const { container } = render(<FeedItem item={userImageItem([{
      mediaType: "image/png",
      historyImageId: "saved_image-1",
    }])} />);

    expect(screen.getByText("Inspect this image")).toBeVisible();
    const link = screen.getByRole("link", { name: "Open attached image 1" });
    expect(link).toHaveAttribute(
      "href",
      "/v2/projects/project%2Fid/sessions/session%20id/images/saved_image-1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  it("shows a placeholder for unavailable or failed images", () => {
    const { container, rerender } = render(<FeedItem item={userImageItem([{ unavailable: true }])} />);
    const view = within(container);
    expect(view.getByRole("img", { name: "Attached image 1 is unavailable" })).toBeVisible();

    rerender(<FeedItem item={userImageItem([{
      mediaType: "image/webp",
      historyImageId: "invalid_image",
    }])} />);
    fireEvent.error(view.getByRole("img", { name: "Attached image 1" }));
    expect(view.getByRole("img", { name: "Attached image 1 is unavailable" })).toBeVisible();
  });

  it("keeps established inline image previews safe and clickable", () => {
    const { container } = render(<FeedItem item={userImageItem([{
      mediaType: "image/jpeg",
      data: "aW1hZ2U=",
    }])} />);
    expect(within(container).getByRole("link", { name: "Open attached image 1" }))
      .toHaveAttribute("href", "data:image/jpeg;base64,aW1hZ2U=");
  });
});

describe("agent Markdown", () => {
  it.each(["Thinking", "Thinking...", "Thinking…"])(
    "hides the Pi-generated streaming placeholder %s",
    (text) => {
      const { container } = render(<FeedItem item={{
        ...assistantItem(text),
        category: "thinking",
        content: { text, state: "streaming" },
      }} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("keeps completed thinking content named Thinking", () => {
    render(<FeedItem item={{
      ...assistantItem("Thinking"),
      category: "thinking",
      content: { text: "Thinking", state: "complete" },
    }} />);
    expect(screen.getByText("Thinking")).toBeVisible();
  });

  it("uses Markdown while streaming and after completion", () => {
    const streaming = {
      ...assistantItem("unused"),
      category: "thinking" as const,
      content: {
        text: "**Comparing markdown CSS and rendering differences**",
        state: "streaming" as const,
      },
    };
    const { rerender } = render(<FeedItem item={streaming} />);
    expect(screen.getByText("Comparing markdown CSS and rendering differences").tagName)
      .toBe("STRONG");
    expect(screen.queryByText("…")).not.toBeInTheDocument();

    rerender(<FeedItem item={{
      ...streaming,
      content: { ...streaming.content, state: "complete" },
    }} />);
    expect(screen.getByText("Comparing markdown CSS and rendering differences").tagName)
      .toBe("STRONG");
  });

  it("uses Markdown for streaming assistant responses", () => {
    render(<FeedItem item={{
      ...assistantItem("**Still streaming**"),
      category: "assistant-response",
      content: { text: "**Still streaming**", state: "streaming" },
    }} />);
    expect(screen.getByText("Still streaming").tagName).toBe("STRONG");
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  it("opens an absolute same-origin shared Markdown link in the Workspace", () => {
    const onOpenSharedMarkdown = vi.fn();
    const url = `${window.location.origin}/shared/session/draft.md`;
    render(<FeedItem item={assistantItem(`[draft](${url})`)} onOpenSharedMarkdown={onOpenSharedMarkdown} />);

    fireEvent.click(screen.getByRole("link", { name: "draft" }));

    expect(onOpenSharedMarkdown).toHaveBeenCalledWith(url);
  });

  it("opens a stable Workspace-relative shared Markdown link in the editor pane", () => {
    const onOpenSharedMarkdown = vi.fn();
    const url = "/shared/session/draft.md";
    render(<FeedItem item={assistantItem(`[draft](${url})`)} onOpenSharedMarkdown={onOpenSharedMarkdown} />);

    fireEvent.click(screen.getByRole("link", { name: "draft" }));

    expect(onOpenSharedMarkdown).toHaveBeenCalledWith(url);
  });

  it("opens a Project Markdown collaboration link in the editor pane", () => {
    const onOpenSharedMarkdown = vi.fn();
    const url = "/project-files/project/session?path=docs%2Fplan.md";
    render(<FeedItem item={assistantItem(`[plan](${url})`)} onOpenSharedMarkdown={onOpenSharedMarkdown} />);

    fireEvent.click(screen.getByRole("link", { name: "plan" }));

    expect(onOpenSharedMarkdown).toHaveBeenCalledWith(url);
  });

  it("renders CommonMark and GFM without active HTML or remote images", () => {
    const { container } = render(<FeedItem item={assistantItem(`
# Result

**Strong** and ~~removed~~ with [docs](https://example.com).

- [x] Complete

| Name | State |
| --- | --- |
| Pi | Ready |

> Quoted

\`inline\`

\`\`\`ts
const ready = true
\`\`\`

![remote diagram](https://example.com/track.png)

<script>alert("unsafe")</script>
`)} />);

    expect(screen.getByRole("heading", { name: "Result" })).toBeVisible();
    expect(screen.getByText("Strong").tagName).toBe("STRONG");
    expect(screen.getByText("removed").tagName).toBe("DEL");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("[Image: remote diagram]")).toBeVisible();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container).toHaveTextContent('<script>alert("unsafe")</script>');
  });
});
