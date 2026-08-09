"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending?: boolean;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  pending = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[400px] gap-0 rounded-[13px] p-0"
        style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
      >
        <div className="border-b border-border2 bg-surface2/60 px-5 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-base font-extrabold tracking-tight">
              {title}
            </DialogTitle>
            {description ? (
              <p className="m-0 text-[13px] leading-relaxed text-muted">
                {description}
              </p>
            ) : null}
          </DialogHeader>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={cn(
              "rounded-lg px-3.5 py-2 text-[12.5px] font-bold transition-colors disabled:opacity-50",
              destructive
                ? "border border-tasks/30 bg-tasks text-white hover:border-tasks/50 hover:bg-tasks/90"
                : "border border-ink bg-ink text-background hover:bg-ink/90",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ ...options, resolve });
    });
  }, []);

  const close = (result: boolean) => {
    request?.resolve(result);
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) close(false);
          }}
          title={request.title}
          description={request.description}
          confirmLabel={request.confirmLabel}
          cancelLabel={request.cancelLabel}
          destructive={request.destructive}
          onConfirm={() => close(true)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return confirm;
}
