import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { ApplicationClient } from "../application/application-client";
import type { ApplicationState } from "../application/application-client-base";
import type { SessionKey } from "../application/workspace-model";
import { KeepSessionModal } from "./KeepSessionModal";
import { Workspace } from "./Workspace";
import { Button } from "./ui/button";
import { Dialog, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);

  useEffect(() => client.subscribe(setState), [client]);
  useEffect(() => () => client.stop(), [client]);
  useEffect(() => {
    if (!open) { client.stop(); return; }
    setLoading(true);
    setError(undefined);
    void client.openQuickSession().then(() => {
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current; });
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Quick Session could not open."))
      .finally(() => setLoading(false));
  }, [client, open]);

  const quickKey = state.sessions.find(({ quickSession }) => quickSession)?.sessionKey ?? state.selectedSessionKey;
  const command = (action: Parameters<ApplicationClient["executeCommand"]>[0]) => quickKey === undefined ? undefined : client.executeCommand(action, quickKey);

  return <>
    <Dialog open={open && !keepOpen} onOpenChange={(next) => {
      if (!next && (clearOpen || keepOpen)) return;
      if (!next && scrollRef.current) savedScroll.current = scrollRef.current.scrollTop;
      onOpenChange(next);
    }}>
      <DialogContent className="quick-session-dialog" aria-describedby={undefined}>
        <DialogHeader className="quick-session-dialog-header">
          <DialogTitle>Quick Session</DialogTitle>
          <span className="quick-session-dialog-actions">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Quick Session actions" />}><Ellipsis aria-hidden="true" size={18} /></DropdownMenuTrigger>
              <DropdownMenuContent className="z-[90] bg-popover" positionerClassName="z-[90]" align="end">
                <DropdownMenuItem onClick={() => setClearOpen(true)}>Clear Session</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setKeepOpen(true)}>Keep Session</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DialogCloseButton />
          </span>
        </DialogHeader>
        {error !== undefined && <p className="quick-session-error" role="alert">{error}</p>}
        {state.quickSessionAction?.status === "pending" && <p className="quick-session-pending" role="status">{state.quickSessionAction.type === "clear" ? "Clear" : "Keep"} waits until Pi finishes. <Button type="button" variant="ghost" size="sm" onClick={() => { void client.cancelQuickSessionAction().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The pending action could not be cancelled.")); }}>Cancel pending action</Button></p>}
        {state.quickSessionAction?.status === "failed" && <p className="quick-session-error" role="alert">{state.quickSessionAction.error ?? "Quick Session action failed."}</p>}
        <div ref={scrollRef} className="quick-session-dialog-body" onScroll={(event) => { savedScroll.current = event.currentTarget.scrollTop; }}>
          {loading && state.selectedSessionKey === undefined ? <p role="status" className="page-loading">Opening Quick Session…</p> : (
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
        setKeepOpen(false);
        onOpenChange(false);
        if (keptKey !== undefined) onKept(keptKey);
      }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Quick Session could not be kept."));
    }} />
  </>;
}
