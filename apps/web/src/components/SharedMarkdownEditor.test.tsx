// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedMarkdownEditor } from "./SharedMarkdownEditor";

const editorCommands = vi.hoisted((): { save: () => void; close: () => void; saveAndClose: () => void } => ({
  save: () => undefined,
  close: () => undefined,
  saveAndClose: () => undefined,
}));
vi.mock("./MarkdownSourceEditor", () => ({
  MarkdownSourceEditor: ({ value, disabled, label, vimMode, onChange, onSave, onClose, onSaveAndClose }: {
    value: string;
    disabled: boolean;
    label: string;
    vimMode: boolean;
    onChange: (value: string) => void;
    onSave: () => void;
    onClose: () => void;
    onSaveAndClose: () => void;
  }) => {
    editorCommands.save = onSave;
    editorCommands.close = onClose;
    editorCommands.saveAndClose = onSaveAndClose;
    return <textarea
      aria-label={label}
      value={value}
      disabled={disabled}
      data-vim-mode={vimMode}
      onChange={(event) => onChange(event.currentTarget.value)}
    />;
  },
}));

const storageValues = new Map<string, string>();
beforeEach(() => {
  storageValues.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, value),
    removeItem: (key: string) => storageValues.delete(key),
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("uses the saved Vim preference without showing an editor toggle", async () => {
  storageValues.set("pi-station:markdown-vim-mode", "true");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Draft")));
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="vim-draft" onClose={vi.fn()} onDirtyChange={vi.fn()} />);

  const editor = await screen.findByRole("textbox", { name: "Markdown content for draft.md" });
  expect(editor).toHaveAttribute("data-vim-mode", "true");
  expect(screen.queryByRole("button", { name: "Vim" })).not.toBeInTheDocument();
  const autosave = screen.getByRole("switch", { name: "Autosave" });
  expect(autosave).not.toBeChecked();
  await userEvent.click(autosave);
  expect(autosave).toBeChecked();
  expect(storageValues.get("pi-station:markdown-autosave")).toBe("true");
});

it("saves and closes after the Vim write-and-quit command succeeds", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("Original"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const onClose = vi.fn();
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="vim-wq-draft" onClose={onClose} onDirtyChange={vi.fn()} />);

  const editor = await screen.findByRole("textbox", { name: "Markdown content for draft.md" });
  fireEvent.change(editor, { target: { value: "Revised" } });
  editorCommands.saveAndClose();

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenLastCalledWith("/shared/session/draft.md", expect.objectContaining({ method: "PUT", body: "Revised" }));
});

it("provides mobile full-screen navigation and overflow actions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Draft")));
  const onClose = vi.fn();
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="mobile-draft" onClose={onClose} onDirtyChange={vi.fn()} />);

  await screen.findByRole("textbox", { name: "Markdown content for draft.md" });
  await userEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "More editor actions" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Open in new tab" })).toHaveAttribute("href", "/shared-editor?file=%2Fshared%2Fsession%2Fdraft.md");
  expect(screen.getByRole("menuitemcheckbox", { name: /Autosave/ })).toHaveAttribute("aria-checked", "false");
});

it("loads, edits, and manually saves shared Markdown", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("Original draft"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const onDirtyChange = vi.fn();
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="test-shared-markdown-draft" onClose={vi.fn()} onDirtyChange={onDirtyChange} />);

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  const editor = screen.getByRole("textbox", { name: "Markdown content for draft.md" });
  expect(editor).toHaveTextContent("Original draft");
  fireEvent.change(editor, { target: { value: "Revised draft" } });
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save" })).toHaveClass("primary");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  expect(fetch).toHaveBeenLastCalledWith("/shared/session/draft.md", expect.objectContaining({ method: "PUT", body: "Revised draft" }));
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("automatically saves after editing when autosave is enabled", async () => {
  storageValues.set("pi-station:markdown-autosave", "true");
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("Original"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="autosave-draft" onClose={vi.fn()} onDirtyChange={vi.fn()} />);

  const editor = await screen.findByRole("textbox", { name: "Markdown content for draft.md" });
  expect(screen.getByRole("switch", { name: "Autosave" })).toBeChecked();
  fireEvent.change(editor, { target: { value: "Autosaved revision" } });

  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), { timeout: 2_000 });
  expect(fetch).toHaveBeenLastCalledWith("/shared/session/draft.md", expect.objectContaining({ method: "PUT", body: "Autosaved revision" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
});

it("shows an external-change choice when a stale Markdown save loses a revision race", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("Original", { headers: { etag: '"revision-1"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 412 }))
    .mockResolvedValueOnce(new Response("Agent revision", { headers: { etag: '"revision-2"' } }));
  vi.stubGlobal("fetch", fetch);
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="conflict-draft" onClose={vi.fn()} onDirtyChange={vi.fn()} />);

  const editor = await screen.findByRole("textbox", { name: "Markdown content for draft.md" });
  fireEvent.change(editor, { target: { value: "My revision" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("File changed externally"));
  expect(screen.getByRole("alert")).toHaveTextContent("The agent changed this file");
  expect(screen.getByRole("button", { name: "Load agent version" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Keep my version" })).toBeEnabled();
  expect(fetch).toHaveBeenNthCalledWith(2, "/shared/session/draft.md", expect.objectContaining({
    method: "PUT",
    body: "My revision",
  }));
  const request = fetch.mock.calls[1]?.[1] as RequestInit;
  expect(request.headers).toEqual(expect.objectContaining({ "If-Match": '"revision-1"' }));
});

it("keeps an edited Markdown draft available after a manual save error", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("Original"))
    .mockResolvedValueOnce(new Response(null, { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  render(<SharedMarkdownEditor file={{ name: "draft.md", url: "/shared/session/draft.md" }} draftKey="failed-draft" onClose={vi.fn()} onDirtyChange={vi.fn()} />);

  const editor = await screen.findByRole("textbox", { name: "Markdown content for draft.md" });
  fireEvent.change(editor, { target: { value: "Unsaved after error" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Save failed"));
  expect(editor).toHaveValue("Unsaved after error");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});
