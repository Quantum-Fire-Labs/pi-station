import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { codeFolding, foldEffect, foldedRanges, foldKeymap, foldService, indentUnit, syntaxHighlighting, syntaxTree, unfoldEffect } from "@codemirror/language";
import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags, type Highlighter, type Tag } from "@lezer/highlight";
import { Vim, vim } from "@replit/codemirror-vim";
import { GFM } from "@lezer/markdown";

interface VimFileCommands {
  readonly save: () => void;
  readonly quit: () => void;
  readonly writeAndQuit: () => void;
}

let activeVimFileCommands: VimFileCommands | undefined;
Vim.defineEx("write", "w", () => activeVimFileCommands?.save());
Vim.defineEx("quit", "q", () => activeVimFileCommands?.quit());
Vim.defineEx("wq", undefined, () => activeVimFileCommands?.writeAndQuit());

function wrapSelection(marker: "*" | "**") {
  return ({ state, dispatch }: { state: EditorState; dispatch: EditorView["dispatch"] }): boolean => {
    const changes = state.changeByRange((range) => {
      const before = range.from >= marker.length
        ? state.sliceDoc(range.from - marker.length, range.from)
        : "";
      const after = state.sliceDoc(range.to, range.to + marker.length);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - marker.length, to: range.from, insert: "" },
            { from: range.to, to: range.to + marker.length, insert: "" },
          ],
          range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
        };
      }
      const selected = state.sliceDoc(range.from, range.to);
      return {
        changes: { from: range.from, to: range.to, insert: `${marker}${selected}${marker}` },
        range: range.empty
          ? EditorSelection.cursor(range.from + marker.length)
          : EditorSelection.range(range.from + marker.length, range.to + marker.length),
      };
    });
    dispatch(state.update(changes, { scrollIntoView: true }));
    return true;
  };
}

const hiddenMarkdownMarks = new Set(["HeaderMark", "EmphasisMark", "LinkMark", "StrikethroughMark"]);

class HeadingFoldWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly folded: boolean) {
    super();
  }

  override eq(other: HeadingFoldWidget): boolean {
    return this.from === other.from && this.to === other.to && this.folded === other.folded;
  }

  toDOM(view: EditorView): HTMLElement {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "md-fold-toggle";
    toggle.textContent = this.folded ? "›" : "⌄";
    toggle.setAttribute("aria-label", this.folded ? "Expand section" : "Collapse section");
    toggle.addEventListener("click", () => {
      view.dispatch({ effects: (this.folded ? unfoldEffect : foldEffect).of({ from: this.from, to: this.to }) });
      view.focus();
    });
    return toggle;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "md-list-bullet";
    bullet.textContent = "•";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

class MarkdownLinkWidget extends WidgetType {
  constructor(readonly label: string, readonly href: string) {
    super();
  }

  override eq(other: MarkdownLinkWidget): boolean {
    return this.label === other.label && this.href === other.href;
  }

  toDOM(): HTMLElement {
    const link = document.createElement("a");
    link.className = "md-rendered-link";
    link.textContent = this.label;
    link.href = this.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly checked: boolean) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return this.from === other.from && this.to === other.to && this.checked === other.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "md-task-checkbox";
    checkbox.checked = this.checked;
    checkbox.disabled = view.state.readOnly;
    checkbox.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    checkbox.addEventListener("change", () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: checkbox.checked ? "[x]" : "[ ]" },
      });
      view.focus();
    });
    return checkbox;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function safeMarkdownLink(value: string): string | undefined {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function markdownSectionFold(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const heading = /^(#{1,6})\s+/u.exec(line.text);
  if (heading === null) return null;
  const level = heading[1]!.length;
  let boundary = state.doc.length;
  for (let number = line.number + 1; number <= state.doc.lines; number += 1) {
    const candidate = state.doc.line(number);
    const nextHeading = /^(#{1,6})\s+/u.exec(candidate.text);
    if (nextHeading !== null && nextHeading[1]!.length <= level) {
      boundary = candidate.from - 1;
      break;
    }
  }
  return boundary > lineEnd ? { from: lineEnd, to: boundary } : null;
}

function livePreviewDecorations(view: EditorView): DecorationSet {
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    activeLines.add(view.state.doc.lineAt(range.head).number);
  }
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (/^ATXHeading[1-6]$/u.test(node.name)) {
        const line = view.state.doc.lineAt(node.from);
        const range = markdownSectionFold(view.state, line.from, line.to);
        if (range !== null) {
          let folded = false;
          foldedRanges(view.state).between(range.from, range.to, (from, to) => {
            if (from === range.from && to === range.to) folded = true;
          });
          decorations.push({
            from: node.from,
            to: node.from,
            value: Decoration.widget({ widget: new HeadingFoldWidget(range.from, range.to, folded), side: -1 }),
          });
        }
      }
      if (node.name === "ListMark" && node.node.parent?.parent?.name === "BulletList") {
        const task = node.node.parent.getChild("Task") !== null;
        decorations.push({
          from: node.from,
          to: node.to,
          value: task ? Decoration.replace({}) : Decoration.replace({ widget: new BulletWidget() }),
        });
        return false;
      }
      if (node.name === "TaskMarker") {
        const checked = /^\[[xX]\]$/u.test(view.state.sliceDoc(node.from, node.to));
        decorations.push({
          from: node.from,
          to: node.to,
          value: Decoration.replace({ widget: new TaskCheckboxWidget(node.from, node.to, checked) }),
        });
        return false;
      }
      if (node.name === "Link" && !activeLines.has(view.state.doc.lineAt(node.from).number)) {
        const source = view.state.sliceDoc(node.from, node.to);
        const match = /^\[([^\]]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)$/u.exec(source);
        const href = match === null ? undefined : safeMarkdownLink(match[2]!);
        if (match !== null && href !== undefined) {
          decorations.push({
            from: node.from,
            to: node.to,
            value: Decoration.replace({ widget: new MarkdownLinkWidget(match[1]!, href) }),
          });
          return false;
        }
      }
      const hideInlineCodeMark = node.name === "CodeMark" && node.node.parent?.name === "InlineCode";
      const hideLinkUrl = node.name === "URL" && node.node.parent?.name === "Link";
      if ((!hiddenMarkdownMarks.has(node.name) && !hideInlineCodeMark && !hideLinkUrl)
        || activeLines.has(view.state.doc.lineAt(node.from).number)) return;
      decorations.push({ from: node.from, to: node.to, value: Decoration.replace({}) });
    },
  });
  return Decoration.set(decorations, true);
}

const markdownLivePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = livePreviewDecorations(view);
  }

  update(update: ViewUpdate): void {
    this.decorations = livePreviewDecorations(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

const hasTag = (values: readonly Tag[], tag: Tag): boolean => values.includes(tag);
const markdownHighlight: Highlighter = {
  style(values) {
    const classes: string[] = [];
    if (hasTag(values, tags.heading1)) classes.push("md-heading-1");
    else if (hasTag(values, tags.heading2)) classes.push("md-heading-2");
    else if (hasTag(values, tags.heading3)) classes.push("md-heading-3");
    else if (values.some((tag) => [tags.heading4, tags.heading5, tags.heading6].includes(tag))) classes.push("md-heading");
    if (hasTag(values, tags.strong)) classes.push("md-strong");
    if (hasTag(values, tags.emphasis)) classes.push("md-emphasis");
    if (hasTag(values, tags.monospace)) classes.push("md-code");
    if (hasTag(values, tags.link) || hasTag(values, tags.url)) classes.push("md-link");
    if (hasTag(values, tags.quote)) classes.push("md-quote");
    if (hasTag(values, tags.punctuation) || hasTag(values, tags.processingInstruction) || hasTag(values, tags.contentSeparator)) classes.push("md-syntax");
    return classes.length === 0 ? null : classes.join(" ");
  },
};

export function MarkdownSourceEditor({ value, disabled, label, vimMode, onChange, onSave, onClose, onSaveAndClose }: {
  value: string;
  disabled: boolean;
  label: string;
  vimMode: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onSaveAndClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!vimMode) return;
    const commands = { save: onSave, quit: onClose, writeAndQuit: onSaveAndClose };
    activeVimFileCommands = commands;
    return () => { if (activeVimFileCommands === commands) activeVimFileCommands = undefined; };
  }, [onClose, onSave, onSaveAndClose, vimMode]);

  useEffect(() => {
    if (host.current === null) return;
    const extensions: Extension[] = [
      ...(vimMode ? [vim()] : []),
      markdown({ extensions: [GFM] }),
      indentUnit.of("\t"),
      EditorState.tabSize.of(8),
      history(),
      highlightActiveLine(),
      foldService.of(markdownSectionFold),
      codeFolding(),
      syntaxHighlighting(markdownHighlight),
      markdownLivePreview,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorState.readOnly.of(disabled),
      EditorView.editable.of(!disabled),
      Prec.highest(keymap.of([
        { key: "Tab", run: indentMore },
        { key: "Shift-Tab", run: indentLess },
      ])),
      keymap.of([
        { key: "Mod-b", run: wrapSelection("**") },
        { key: "Mod-i", run: wrapSelection("*") },
        { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    const instance = new EditorView({ parent: host.current, state: EditorState.create({ doc: value, extensions }) });
    view.current = instance;
    return () => { instance.destroy(); view.current = undefined; };
  }, [disabled, label, vimMode]);

  useEffect(() => {
    const instance = view.current;
    if (instance === undefined || instance.state.doc.toString() === value) return;
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
  }, [value]);

  return <div className="markdown-source-editor" ref={host} />;
}
