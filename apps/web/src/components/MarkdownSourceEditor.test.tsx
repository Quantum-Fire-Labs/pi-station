// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownSourceEditor, markdownSectionFold } from "./MarkdownSourceEditor";

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

it("renders task checkboxes without list dashes on every line", () => {
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

  const open = screen.getByRole("checkbox", { name: "Mark task complete" });
  const completed = screen.getByRole("checkbox", { name: "Mark task incomplete" });
  expect(open).not.toBeChecked();
  expect(completed).toBeChecked();
  expect(container.querySelector(".cm-content")).not.toHaveTextContent("- [");

  fireEvent.click(open);
  expect(onChange).toHaveBeenLastCalledWith("- [x] Open task\n  - [X] Nested completed task");
});

it("renders unordered markers as bullets and inactive safe links as anchors", () => {
  const { container } = render(<MarkdownSourceEditor
    value={"Plain line\n- First\n* Second\n+ [Pi Station](https://example.com/docs)\n- [unsafe](javascript:alert(1))\n1. Ordered"}
    disabled={false}
    label="Rendered structures"
    vimMode={false}
    onChange={vi.fn()}
    onSave={vi.fn()}
    onClose={vi.fn()}
    onSaveAndClose={vi.fn()}
  />);

  expect(container.querySelectorAll(".md-list-bullet")).toHaveLength(4);
  expect(container.querySelector(".cm-content")).toHaveTextContent("• First");
  expect(container.querySelector(".cm-content")).toHaveTextContent("1. Ordered");
  const link = screen.getByRole("link", { name: "Pi Station" });
  expect(link).toHaveAttribute("href", "https://example.com/docs");
  expect(link).toHaveAttribute("target", "_blank");
  expect(screen.queryByRole("link", { name: "unsafe" })).not.toBeInTheDocument();
});

it("folds a heading through its descendants but not the next peer heading", () => {
  const state = EditorState.create({ doc: "# First\nintro\n## Child\ndetail\n# Second\nend" });
  const first = state.doc.line(1);
  const child = state.doc.line(3);
  expect(markdownSectionFold(state, first.from, first.to)).toEqual({ from: first.to, to: state.doc.line(5).from - 1 });
  expect(markdownSectionFold(state, child.from, child.to)).toEqual({ from: child.to, to: state.doc.line(5).from - 1 });
  expect(markdownSectionFold(state, state.doc.line(2).from, state.doc.line(2).to)).toBeNull();
});

it("places section toggles inside heading lines and updates their accessible state", () => {
  const { container } = render(<MarkdownSourceEditor
    value={"# Section\ncontent\n# Next\nmore"}
    disabled={false}
    label="Fold sections"
    vimMode={false}
    onChange={vi.fn()}
    onSave={vi.fn()}
    onClose={vi.fn()}
    onSaveAndClose={vi.fn()}
  />);

  const collapse = screen.getAllByRole("button", { name: "Collapse section" })[0]!;
  expect(collapse.closest(".cm-line")).not.toBeNull();
  fireEvent.click(collapse);
  expect(screen.getByRole("button", { name: "Expand section" })).toBeInTheDocument();
  expect(container.querySelector(".cm-foldPlaceholder")).not.toBeNull();
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
