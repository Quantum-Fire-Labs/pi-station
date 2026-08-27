// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";

afterEach(cleanup);

it("shows Markdown syntax only on the active line", () => {
  const { container } = render(<MarkdownSourceEditor
    value={"# Active heading\n**Inactive bold** and [link](https://example.com)"}
    disabled={false}
    label="Markdown content"
    vimMode={false}
    onChange={vi.fn()}
    onSave={vi.fn()}
    onClose={vi.fn()}
    onSaveAndClose={vi.fn()}
  />);

  const editor = screen.getByRole("textbox", { name: "Markdown content" });
  expect(container.querySelector(".cm-content")).toHaveTextContent("# Active heading");
  expect(container.querySelector(".cm-content")).toHaveTextContent("Inactive bold and link");
  expect(container.querySelector(".cm-content")).not.toHaveTextContent("**Inactive bold**");
  expect(container.querySelector(".cm-content")).not.toHaveTextContent("https://example.com");

  EditorView.findFromDOM(editor)!.dispatch({ selection: { anchor: 18 } });

  expect(container.querySelector(".cm-content")).toHaveTextContent("Active heading");
  expect(container.querySelector(".cm-content")).not.toHaveTextContent("# Active heading");
  expect(container.querySelector(".cm-content")).toHaveTextContent("**Inactive bold**");
  expect(container.querySelector(".cm-content")).toHaveTextContent("https://example.com");
});

it("renders task checkboxes outside the active line and reveals the active marker", () => {
  const onChange = vi.fn();
  const { container } = render(<MarkdownSourceEditor
    value={"- [ ] Open task\n  - [X] Nested completed task"}
    disabled={false}
    label="Task list"
    vimMode={false}
    onChange={onChange}
    onSave={vi.fn()}
    onClose={vi.fn()}
    onSaveAndClose={vi.fn()}
  />);

  expect(container.querySelector(".cm-activeLine")).toHaveTextContent("[ ] Open task");
  const completed = screen.getByRole("checkbox", { name: "Mark task incomplete" });
  expect(completed).toBeChecked();
  fireEvent.click(completed);
  expect(onChange).toHaveBeenLastCalledWith("- [ ] Open task\n  - [ ] Nested completed task");

  const editor = screen.getByRole("textbox", { name: "Task list" });
  EditorView.findFromDOM(editor)!.dispatch({ selection: { anchor: 20 } });

  expect(container.querySelector(".cm-activeLine")).toHaveTextContent("[ ] Nested completed task");
  const open = screen.getByRole("checkbox", { name: "Mark task complete" });
  expect(open).not.toBeChecked();
  fireEvent.click(open);
  expect(onChange).toHaveBeenLastCalledWith("- [x] Open task\n  - [ ] Nested completed task");
});

it("uses literal tabs for Tab indentation and keeps focus in the editor", () => {
  const onChange = vi.fn();
  render(<MarkdownSourceEditor
    value={"- [ ] First task\n- [ ] Second task"}
    disabled={false}
    label="Indent tasks"
    vimMode={false}
    onChange={onChange}
    onSave={vi.fn()}
    onClose={vi.fn()}
    onSaveAndClose={vi.fn()}
  />);

  const editor = screen.getByRole("textbox", { name: "Indent tasks" });
  expect(editor).toHaveStyle({ tabSize: "8" });
  editor.focus();
  EditorView.findFromDOM(editor)!.dispatch({ selection: { anchor: 20 } });
  fireEvent.keyDown(editor, { key: "Tab" });

  expect(onChange).toHaveBeenLastCalledWith("- [ ] First task\n\t- [ ] Second task");
  expect(editor).toHaveFocus();

  fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith("- [ ] First task\n- [ ] Second task");
});
