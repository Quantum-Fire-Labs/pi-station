import { useEffect, useState } from "react";
import { SharedMarkdownEditor, type SharedMarkdownFile } from "./SharedMarkdownEditor";

export function StandaloneSharedMarkdownEditor({ file }: { file: SharedMarkdownFile }) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    document.title = file.name;
  }, [file.name]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <main className="standalone-shared-editor editor-open">
      <SharedMarkdownEditor
        file={file}
        draftKey={`pi-station:standalone-shared-markdown-draft:${file.url}`}
        onClose={() => undefined}
        onDirtyChange={setDirty}
      />
    </main>
  );
}
