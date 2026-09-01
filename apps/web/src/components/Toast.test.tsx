// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./Toast";

function Trigger({ variant = "success" as const }: { readonly variant?: "success" | "error" | "info" }) {
  const { toast } = useToast();
  return <button type="button" onClick={() => toast({ message: `${variant} message`, variant, duration: 1000 })}>Notify</button>;
}

describe("ToastProvider", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("announces, closes, and automatically dismisses notifications", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("status")).toHaveTextContent("success message");
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses an assertive alert for errors", () => {
    render(<ToastProvider><Trigger variant="error" /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });
});
