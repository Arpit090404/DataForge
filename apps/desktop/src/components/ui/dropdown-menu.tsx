import { Menu } from '@base-ui/react/menu';
import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ children, className, align = 'end' }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end' }) {
  return <Menu.Portal>
    <Menu.Positioner align={align} sideOffset={4} positionMethod="fixed" className="z-50">
      <Menu.Popup data-slot="menu-content" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} className={cn('min-w-[135px] rounded-[var(--radius-small)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-[var(--space-1)] text-[length:var(--font-size-secondary)] text-[var(--color-text)] shadow-[0_6px_18px_var(--color-shadow)] outline-none', className)}>
        {children}
      </Menu.Popup>
    </Menu.Positioner>
  </Menu.Portal>;
}

export function DropdownMenuItem({ className, destructive, ...props }: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return <Menu.Item data-slot="menu-item" className={cn('flex min-h-[var(--control-height-small)] cursor-pointer items-center rounded-[var(--radius-small)] px-[var(--space-2)] outline-none data-[highlighted]:bg-[var(--color-hover)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50', destructive && 'text-[var(--color-destructive)] data-[highlighted]:bg-[var(--color-error-surface)]', className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-[var(--space-1)] h-px bg-[var(--color-border)]" />;
}
