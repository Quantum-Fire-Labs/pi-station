import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { tags, type Highlighter, type Tag } from "@lezer/highlight";
import { Vim, vim } from "@replit/codemirror-vim";

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

function livePreviewDecorations(view: EditorView): DecorationSet {
  const activeLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    activeLines.add(view.state.doc.lineAt(range.head).number);
  }
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];
  syntaxTree(view.state).iterate({
    enter(node) {
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
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = livePreviewDecorations(update.view);
    }
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
      markdown(),
      history(),
      highlightActiveLine(),
      syntaxHighlighting(markdownHighlight),
      markdownLivePreview,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      EditorState.readOnly.of(disabled),
      EditorView.editable.of(!disabled),
      keymap.of([
        { key: "Mod-b", run: wrapSelection("**") },
        { key: "Mod-i", run: wrapSelection("*") },
        { key: "Mod-s", preventDefault: true, run: () => { onSaveRef.current(); return true; } },
        ...defaultKeymap,
        ...historyKeymap,
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
