// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { fixtureState } from "../fixtures/workspace";
import type { ApplicationState } from "../application/application-client-base";
import { QuickSessionDialog } from "./QuickSessionDialog";

const mock = vi.hoisted(() => ({
  listener: undefined as ((state: ApplicationState) => void) | undefined,
  state: undefined as ApplicationState | undefined,
  open: vi.fn(), clear: vi.fn(), keep: vi.fn(), cancel: vi.fn(), stop: vi.fn(), command: vi.fn(),
}));

vi.mock("../application/application-client", () => ({
  ApplicationClient: class {
    get snapshot() { return mock.state; }
    subscribe(listener: (state: ApplicationState) => void) { mock.listener = listener; return () => { mock.listener = undefined; }; }
    stop = mock.stop;
    openQuickSession = mock.open;
    clearQuickSession = mock.clear;
    keepQuickSession = mock.keep;
    cancelQuickSessionAction = mock.cancel;
    executeCommand = mock.command;
    requestEarlierHistory() { return false; }
    uploadImage() { return Promise.resolve("image"); }
    deleteImage() { return Promise.resolve(); }
    uploadAttachment() { return Promise.resolve("attachment"); }
    deleteAttachment() { return Promise.resolve(); }
    listDirectory() { return "directory"; }
    select() {}
  },
}));

const quickKey = { hostId: "quick-session", piSessionId: "quick-1" };
const quickState = (): ApplicationState => ({
  ...fixtureState,
  sessions: [{ ...fixtureState.sessions[0]!, sessionKey: quickKey, quickSession: true }],
  selectedSessionKey: quickKey,
  selected: fixtureState.selected,
});

function Harness() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const change = (value: boolean): void => { setOpen(value); if (!value) queueMicrotask(() => trigger.current?.focus()); };
  return <><button ref={trigger} onClick={() => setOpen(true)}>Quick Session</button><textarea aria-label="Normal draft" defaultValue="normal draft" /><div data-testid="normal-scroll" data-scroll="417" /><QuickSessionDialog open={open} onOpenChange={change} onKept={vi.fn()} /></>;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
  mock.state = quickState();
  mock.open.mockReset().mockResolvedValue(quickKey);
  mock.clear.mockReset().mockResolvedValue(undefined);
  mock.keep.mockReset().mockResolvedValue(undefined);
  mock.cancel.mockReset().mockResolvedValue(undefined);
  mock.stop.mockReset(); mock.command.mockReset();
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openDialog() { await userEvent.click(screen.getByRole("button", { name: "Quick Session" })); return screen.findByRole("dialog", { name: "Quick Session" }); }
async function openActions() { fireEvent.click(screen.getByRole("button", { name: "Quick Session actions" })); await screen.findByRole("menu"); }

describe("QuickSessionDialog", () => {
  it("clears after confirmation and keeps the modal open", async () => {
    render(<Harness />); await openDialog(); await openActions(); await userEvent.click(screen.getByRole("menuitem", { name: "Clear Session" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear Session" }));
    expect(mock.clear).toHaveBeenCalledOnce(); expect(screen.getByRole("dialog", { name: "Quick Session" })).toBeVisible();
  });

  it("keeps to the selected Project and closes", async () => {
    const onKept = vi.fn(); const { rerender } = render(<QuickSessionDialog open onOpenChange={vi.fn()} onKept={onKept} />);
    await screen.findByRole("dialog", { name: "Quick Session" }); await openActions(); await userEvent.click(screen.getByRole("menuitem", { name: "Keep Session" }));
    const keepDialog = await screen.findByRole("dialog", { name: "Keep Quick Session" });
    await userEvent.click(within(keepDialog).getByRole("button", { name: "Keep Session" }));
    await waitFor(() => expect(mock.keep).toHaveBeenCalledWith(fixtureState.projects[0]!.displayPath));
    expect(onKept).toHaveBeenCalledWith(quickKey); rerender(<QuickSessionDialog open={false} onOpenChange={vi.fn()} onKept={onKept} />);
  });

  it("cancels a deferred action and surfaces a failure", async () => {
    render(<Harness />); await openDialog();
    mock.listener?.({ ...quickState(), quickSessionAction: { type: "keep", status: "pending" } });
    await userEvent.click(await screen.findByRole("button", { name: "Cancel pending action" })); expect(mock.cancel).toHaveBeenCalledOnce();
    mock.listener?.({ ...quickState(), quickSessionAction: { type: "keep", status: "failed", error: "Destination conflict." } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Destination conflict.");
  });

  it("closes with Escape and outside click, restores focus, and preserves normal state", async () => {
    render(<Harness />); const trigger = screen.getByRole("button", { name: "Quick Session" }); await openDialog();
    await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByLabelText("Normal draft")).toHaveValue("normal draft"); expect(screen.getByTestId("normal-scroll")).toHaveAttribute("data-scroll", "417");
    await openDialog(); const overlay = document.querySelector('[data-slot="dialog-overlay"]')!; fireEvent.mouseDown(overlay); fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Quick Session" })).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("preserves its draft and scroll position after close and reopen", async () => {
    render(<Harness />); await openDialog(); const composer = screen.getAllByLabelText("Message Pi").at(-1)!; await userEvent.type(composer, "quick draft");
    const body = document.querySelector('.quick-session-dialog-body') as HTMLDivElement; Object.defineProperty(body, "scrollTop", { value: 321, writable: true }); fireEvent.scroll(body);
    await userEvent.keyboard("{Escape}"); await openDialog();
    expect(screen.getAllByLabelText("Message Pi").at(-1)).toHaveValue("quick draft");
    await waitFor(() => expect((document.querySelector('.quick-session-dialog-body') as HTMLDivElement).scrollTop).toBe(321));
  });
});
