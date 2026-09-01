'use client';

import { useState, useCallback, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmState {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
  resolve: (value: boolean) => void;
}

/**
 * Promise-based confirmation hook — replaces window.confirm() which breaks
 * keyboard focus on Windows after the native dialog closes.
 *
 * Usage:
 *   const { confirm, ConfirmDialog } = useConfirm();
 *
 *   const handleDelete = async (id: number) => {
 *     if (!await confirm('Delete this item?')) return;
 *     await api.delete(`/items/${id}`);
 *   };
 *
 *   return (
 *     <>
 *       {ConfirmDialog}
 *       <button onClick={() => handleDelete(1)}>Delete</button>
 *     </>
 *   );
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (
      message: string,
      options?: {
        title?: string;
        confirmLabel?: string;
        destructive?: boolean;
      },
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          open: true,
          message,
          title: options?.title,
          confirmLabel: options?.confirmLabel,
          destructive: options?.destructive,
          resolve,
        });
      });
    },
    [],
  );

  const cleanupBodyLock = useCallback(() => {
    if (typeof document !== 'undefined') {
      document.body.style.pointerEvents = '';
      document.body.removeAttribute('data-scroll-locked');
      // Restore focus to active window/viewport
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, []);

  const handleConfirm = useCallback(() => {
    const resolver = state?.resolve;
    setState((prev) => (prev ? { ...prev, open: false } : null));
    cleanupBodyLock();
    setTimeout(() => {
      resolver?.(true);
      setState(null);
      cleanupBodyLock();
    }, 50);
  }, [state, cleanupBodyLock]);

  const handleCancel = useCallback(() => {
    const resolver = state?.resolve;
    setState((prev) => (prev ? { ...prev, open: false } : null));
    cleanupBodyLock();
    setTimeout(() => {
      resolver?.(false);
      setState(null);
      cleanupBodyLock();
    }, 50);
  }, [state, cleanupBodyLock]);

  const ConfirmDialog: ReactNode = state ? (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{state.title || 'Konfirmasi'}</DialogTitle>
          <DialogDescription>{state.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Batal
          </Button>
          <Button
            variant={state.destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
          >
            {state.confirmLabel || 'Ya, Lanjutkan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { confirm, ConfirmDialog };
}
