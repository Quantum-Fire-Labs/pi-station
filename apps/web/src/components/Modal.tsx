import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";

export function Modal({
  open,
  title,
  description,
  eyebrow,
  children,
  actions,
  initialFocus,
  busy = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  children: ReactNode;
  actions: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  busy?: boolean;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generatedId = useId();
  const titleId = `modal-title-${generatedId}`;
  const descriptionId = `modal-description-${generatedId}`;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      requestAnimationFrame(() => initialFocus?.current?.focus());
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [initialFocus, open]);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form className="modal-panel" onSubmit={onSubmit}>
        <header className="modal-header">
          {eyebrow && <p className="modal-eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p id={descriptionId} className="modal-description">
              {description}
            </p>
          )}
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-actions">{actions}</footer>
      </form>
    </dialog>
  );
}
