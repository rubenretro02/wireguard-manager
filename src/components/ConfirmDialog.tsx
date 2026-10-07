"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for deletes. */
  destructive?: boolean;
}

/**
 * In-app replacement for window.confirm(). Native confirm() is blocked inside the
 * Telegram webview (the admin panel opens there via /tg/admin) and gets silently
 * suppressed by browsers after "don't show again", so destructive actions need a
 * real dialog. Resolves true only when the user presses the confirm button.
 *
 *   const [confirmDialog, confirmAction] = useConfirm();
 *   if (!(await confirmAction({ title: "Delete peer?", destructive: true }))) return;
 *   …
 *   return <>{confirmDialog}</>;   // render once per page
 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirmAction = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A prompt still pending when a new one opens counts as cancelled.
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
      }),
    []
  );

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => { if (!open) settle(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          {options?.description !== undefined && (
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground">{options.description}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {options?.cancelLabel || "Cancel"}
          </Button>
          <Button variant={options?.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
            {options?.confirmLabel || "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return [dialog, confirmAction];
}
