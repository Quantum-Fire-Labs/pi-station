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

it("renders task markers as interactive checkboxes on every line", () => {
  const onChange = vi.fn();
  render(<MarkdownSourceEditor
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

  fireEvent.click(open);
  expect(onChange).toHaveBeenLastCalledWith("- [x] Open task\n  - [X] Nested completed task");

  fireEvent.click(completed);
  expect(onChange).toHaveBeenLastCalledWith("- [x] Open task\n  - [ ] Nested completed task");
});
