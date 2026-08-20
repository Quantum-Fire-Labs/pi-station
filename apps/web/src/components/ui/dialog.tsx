import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "./button"

function Dialog(props: DialogPrimitive.Root.Props) { return <DialogPrimitive.Root data-slot="dialog" {...props} /> }
function DialogTrigger(props: DialogPrimitive.Trigger.Props) { return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} /> }
function DialogPortal(props: DialogPrimitive.Portal.Props) { return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} /> }
function DialogClose(props: DialogPrimitive.Close.Props) { return <DialogPrimitive.Close data-slot="dialog-close" {...props} /> }
function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={cn("fixed inset-0 z-[80] bg-black/50 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className)} {...props} />
}
function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return <DialogPortal><DialogOverlay /><DialogPrimitive.Popup data-slot="dialog-content" className={cn("fixed left-1/2 top-1/2 z-[81] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 text-foreground shadow-lg duration-200 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:max-w-lg", className)} {...props}>{children}</DialogPrimitive.Popup></DialogPortal>
}
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) { return <div data-slot="dialog-header" className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} /> }
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) { return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg font-semibold leading-none", className)} {...props} /> }
function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) { return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} /> }
function DialogCloseButton() { return <DialogClose render={<Button variant="ghost" size="icon" aria-label="Close Quick Session" />}><X aria-hidden="true" size={18} /></DialogClose> }

export { Dialog, DialogClose, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger }
