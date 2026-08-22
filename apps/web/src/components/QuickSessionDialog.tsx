import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Ellipsis, Minus } from "lucide-react";
import { ApplicationClient } from "../application/application-client";
import type { ApplicationState } from "../application/application-client-base";
import type { SessionKey } from "../application/workspace-model";
import { KeepSessionModal } from "./KeepSessionModal";
import { Workspace } from "./Workspace";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

interface QuickSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKept: (key: SessionKey) => void;
}

export function QuickSessionDialog({ open, onOpenChange, onKept }: QuickSessionDialogProps) {
  const [client] = useState(() => new ApplicationClient());
  const [state, setState] = useState<ApplicationState>(() => client.snapshot);
  const [clearOpen, setClearOpen] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const dragOffset = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragPosition = useRef<{ x: number; y: number } | undefined>(undefined);
  const initialized = useRef(false);

  useEffect(() => client.subscribe(setState), [client]);
  useEffect(() => () => client.stop(), [client]);
  useEffect(() => {
    if (!open) return;
    const restore = (): void => {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
        document.querySelector<HTMLElement>(".quick-session-dialog #prompt")?.focus();
      });
    };
    if (initialized.current) { restore(); return; }
    setLoading(true);
    setError(undefined);
    void client.openQuickSession().then(() => {
      initialized.current = true;
      client.connect();
      restore();
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Quick Session could not open."))
      .finally(() => setLoading(false));
  }, [client, open]);

  const quickKey = state.sessions.find(({ quickSession }) => quickSession)?.sessionKey ?? state.selectedSessionKey;
  const command = (action: Parameters<ApplicationClient["executeCommand"]>[0]) => quickKey === undefined ? undefined : client.executeCommand(action, quickKey);
  const interactiveDragTarget = (target: EventTarget | null): boolean => target instanceof Element && target.closest("button, a, input, textarea, select, [role=button]") !== null;
  const moveDialog = (event: React.PointerEvent<HTMLElement>): void => {
    const offset = dragOffset.current;
    const dialog = dialogRef.current;
    if (offset === undefined || dialog === null) return;
    const bounds = dialog.getBoundingClientRect();
    const next = {
      x: Math.min(Math.max(8, event.clientX - offset.x), Math.max(8, window.innerWidth - bounds.width - 8)),
      y: Math.min(Math.max(8, event.clientY - offset.y), Math.max(8, window.innerHeight - bounds.height - 8)),
    };
    dragPosition.current = next;
    dialog.style.left = "0";
    dialog.style.top = "0";
    dialog.style.translate = "0 0";
    dialog.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
  };

  return <>
    <Dialog open={open && !keepOpen} onOpenChange={(next) => {
      if (!next && (clearOpen || keepOpen)) return;
      if (!next && scrollRef.current) savedScroll.current = scrollRef.current.scrollTop;
      onOpenChange(next);
    }}>
      <DialogContent
        ref={dialogRef}
        className={`quick-session-dialog gap-0 overflow-hidden p-0 sm:max-w-none${dragging ? " is-dragging" : ""}`}
        aria-describedby={undefined}
        initialFocus={false}
        style={position === undefined ? undefined : { left: 0, top: 0, translate: "0 0", transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
        onDoubleClick={(event) => { if (!interactiveDragTarget(event.target)) { dragPosition.current = undefined; setPosition(undefined); } }}
        onPointerDown={(event) => {
          if (event.button !== 0 || dialogRef.current === null || !(event.target instanceof Node) || !dialogRef.current.contains(event.target) || interactiveDragTarget(event.target) || window.matchMedia("(max-width: 760px)").matches) return;
          const bounds = dialogRef.current.getBoundingClientRect();
          dragOffset.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
          dragPosition.current = position;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={moveDialog}
        onPointerUp={(event) => { dragOffset.current = undefined; setPosition(dragPosition.current); setDragging(false); event.currentTarget.releasePointerCapture?.(event.pointerId); }}
        onPointerCancel={() => { dragOffset.current = undefined; setPosition(dragPosition.current); setDragging(false); }}
      >
        <DialogHeader className="quick-session-dialog-header flex-row gap-1 text-left">
          <button className="mobile-back quick-session-mobile-back" type="button" onClick={() => onOpenChange(false)} aria-label="Back to Dashboard">
            <ArrowLeft aria-hidden="true" size={19} />
          </button>
          <div className="quick-session-mobile-heading">
            <DialogTitle>Quick Session</DialogTitle>
            <small>{state.selected.details?.model?.modelId ?? "gpt-5.6-sol"} · {state.selected.details?.thinkingLevel ?? "Medium"}</small>
          </div>
          <span className="quick-session-dialog-actions">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Quick Session actions" />}><Ellipsis aria-hidden="true" size={18} /></DropdownMenuTrigger>
              <DropdownMenuContent className="z-[90] bg-popover" positionerClassName="z-[90]" align="end">
                <DropdownMenuItem onClick={() => setKeepOpen(true)}>Keep Session</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setClearOpen(true)}>Clear Session</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button className="quick-session-minimize" type="button" variant="ghost" size="icon" aria-label="Minimize Quick Session" onClick={() => onOpenChange(false)}>
              <Minus aria-hidden="true" size={18} />
            </Button>
          </span>
        </DialogHeader>
        {error !== undefined && <p className="quick-session-error" role="alert">{error}</p>}
        {state.quickSessionAction?.status === "pending" && <p className="quick-session-pending" role="status">{state.quickSessionAction.type === "clear" ? "Clear" : "Keep"} waits until Pi finishes. <Button type="button" variant="ghost" size="sm" onClick={() => { void client.cancelQuickSessionAction().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The pending action could not be cancelled.")); }}>Cancel pending action</Button></p>}
        {state.quickSessionAction?.status === "failed" && <p className="quick-session-error" role="alert">{state.quickSessionAction.error ?? "Quick Session action failed."}</p>}
        <div ref={scrollRef} className="quick-session-dialog-body" onScroll={(event) => { savedScroll.current = event.currentTarget.scrollTop; }}>
          {loading ? <div className="quick-session-loading"><div className="initial-connection-content" role="status" aria-live="polite"><span className="initial-connection-mark" aria-hidden="true" /><p>Opening Quick Session…</p></div></div> : (
            <Workspace embeddedSession state={state} client={client} onSelect={(key) => client.select(key)} onCommand={command} onLoadEarlier={() => client.requestEarlierHistory()} onUploadImage={(file, signal) => client.uploadImage(file, signal)} onDeleteImage={(id) => client.deleteImage(id)} onUploadAttachment={(file, signal) => client.uploadAttachment(file, signal)} onDeleteAttachment={(id) => client.deleteAttachment(id)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
      <AlertDialogContent className="z-[100] bg-popover">
        <AlertDialogHeader><AlertDialogTitle>Clear Quick Session?</AlertDialogTitle><AlertDialogDescription>This removes its history and managed files. Closing the modal does not clear it.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { setClearOpen(false); setError(undefined); void client.clearQuickSession().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Quick Session could not be cleared.")); }}>Clear Session</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <KeepSessionModal open={keepOpen} state={state} onClose={() => setKeepOpen(false)} onListDirectory={(path, hidden) => client.listDirectory(path, hidden)} onKeep={(destination) => {
      const keptKey = quickKey;
      setError(undefined);
      void client.keepQuickSession(destination).then(() => {
        initialized.current = false;
        setKeepOpen(false);
        onOpenChange(false);
        if (keptKey !== undefined) onKept(keptKey);
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Quick Session could not be kept."));
    }} />
  </>;
}
