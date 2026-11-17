import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { cn } from 'cn';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogBackdrop = DialogPrimitive.Backdrop;
export const DialogPopup = DialogPrimitive.Popup;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const AlertDialog = AlertDialogPrimitive.Root;

export function DialogContent({ children, className, initialFocus }: { children: ReactNode; className?: string; initialFocus?: ComponentProps<typeof DialogPrimitive.Popup>['initialFocus'] }) {
  return <DialogPrimitive.Portal className="ui-dialog-portal">
    <DialogPrimitive.Backdrop className="ui-dialog-backdrop" />
    <DialogPrimitive.Popup initialFocus={initialFocus} className={cn('ui-dialog-popup', className)}>{children}</DialogPrimitive.Popup>
  </DialogPrimitive.Portal>;
}

export function DialogHeader({ children }: { children: ReactNode }) { return <div className="ui-dialog-header">{children}</div>; }
export function DialogBody({ children }: { children: ReactNode }) { return <div className="ui-dialog-body">{children}</div>; }
export function DialogFooter({ children }: { children: ReactNode }) { return <div className="ui-dialog-footer">{children}</div>; }

export function ConfirmationDialog({ open, title, description, confirmLabel, destructive = false, busy = false, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; destructive?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <AlertDialog open={open} onOpenChange={next => { if (!next && !busy) onCancel(); }}>
    <AlertDialogPrimitive.Portal className="ui-dialog-portal">
      <AlertDialogPrimitive.Backdrop className="ui-dialog-backdrop" />
      <AlertDialogPrimitive.Popup className="ui-dialog-popup ui-confirmation-popup" initialFocus={cancelRef}>
        <DialogHeader><AlertDialogPrimitive.Title>{title}</AlertDialogPrimitive.Title></DialogHeader>
        <DialogBody><AlertDialogPrimitive.Description>{description}</AlertDialogPrimitive.Description></DialogBody>
        <DialogFooter><Button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>Cancel</Button><Button type="button" variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button></DialogFooter>
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  </AlertDialog>;
}
