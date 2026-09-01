import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastOptions {
  readonly message: string;
  readonly variant?: ToastVariant;
  readonly duration?: number;
}

interface ToastItem extends ToastOptions {
  readonly id: number;
  readonly variant: ToastVariant;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => 0, dismissToast: () => undefined });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...options, id, variant: options.variant ?? "info" }]);
    return id;
  }, []);

  return <ToastContext.Provider value={{ toast, dismissToast }}>
    {children}
    <div className="toast-viewport" aria-label="Notifications">
      {toasts.map((item) => <Toast key={item.id} item={item} dismiss={() => dismissToast(item.id)} />)}
    </div>
  </ToastContext.Provider>;
}

function Toast({ item, dismiss }: { readonly item: ToastItem; readonly dismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(dismiss, item.duration ?? 5000);
    return () => window.clearTimeout(timer);
  }, [dismiss, item.duration]);
  const Icon = item.variant === "success" ? CheckCircle2 : item.variant === "error" ? CircleAlert : Info;
  return <div className={`toast toast-${item.variant}`} role={item.variant === "error" ? "alert" : "status"} aria-live={item.variant === "error" ? "assertive" : "polite"}>
    <Icon aria-hidden="true" size={18} />
    <span>{item.message}</span>
    <button type="button" onClick={dismiss} aria-label="Close notification"><X aria-hidden="true" size={16} /></button>
  </div>;
}
